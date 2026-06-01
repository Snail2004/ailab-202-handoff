import hashlib
import html
import re
import zipfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from config import DATASET_FILES, EXTRACTION_TOOL, PIPELINE_VERSION, SCHEMA_VERSION
from services.audit_log import log_event
from services.dataset_io import atomic_write_text, read_json, write_json_atomic, write_jsonl_atomic
from services.workspace import ProjectError, ensure_project_dirs, ensure_working_files, find_source_file


CHAPTER_RE = re.compile(
    r"^\s*(chapter\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b.*)$",
    re.IGNORECASE,
)


class BlockHTMLParser(HTMLParser):
    block_tags = {"h1", "h2", "h3", "p", "li", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str, str]] = []
        self._tag_stack: list[str] = []
        self._current_tag: str | None = None
        self._chunks: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in self.block_tags:
            self._flush()
            self._current_tag = tag
            self._chunks = []
        self._tag_stack.append(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._current_tag == tag:
            self._flush()
        if tag in self._tag_stack:
            self._tag_stack.remove(tag)

    def handle_data(self, data):
        if self._current_tag:
            self._chunks.append(data)

    def _flush(self):
        if not self._current_tag:
            return
        text = normalize_text(" ".join(self._chunks))
        if text:
            self.blocks.append((self._current_tag, text))
        self._current_tag = None
        self._chunks = []

    def close(self):
        self._flush()
        super().close()


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def default_metadata(doc_id: str, source_path: Path, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = dict(metadata or {})
    source_format = source_path.suffix.lower().lstrip(".") or meta.get("source_format") or "txt"
    return {
        "title": meta.get("title") or doc_id,
        "author": meta.get("author") or "",
        "domain": meta.get("domain") or "literature",
        "genre": meta.get("genre") or "novel",
        "source_language": "en",
        "target_language": "vi",
        "source_format": meta.get("source_format") or source_format,
        "license": meta.get("license") or "unknown",
        "license_url": meta.get("license_url") or "",
        "source_url": meta.get("source_url") or "",
        "raw_sha256": sha256_file(source_path),
        "retrieved_at": meta.get("retrieved_at") or now_iso(),
        "extraction_tool": EXTRACTION_TOOL,
        "pipeline_version": PIPELINE_VERSION,
        "contamination_risk": meta.get("contamination_risk") or "medium",
    }


def block_type_for(text: str, tag: str | None = None) -> str:
    lowered = text.lower()
    if tag in {"h1", "h2", "h3"} or CHAPTER_RE.match(text):
        return "heading"
    if lowered.startswith("[editor") or lowered.startswith("[translator") or lowered.startswith("note:"):
        return "footnote"
    quote_count = text.count('"') + text.count("“") + text.count("”")
    if text.startswith(('"', "“", "'")) or quote_count >= 2:
        return "dialogue"
    return "paragraph"


def make_block(doc_id: str, chapter_id: str, index: int, text: str, btype: str, opening: bool) -> dict[str, Any]:
    block_id = f"{chapter_id}_b{index:03d}"
    return {
        "block_id": block_id,
        "order_index": index,
        "page_ids": [],
        "block_type": btype,
        "is_chapter_opening": opening,
        "source_text": text,
        "clean_text": text,
        "sentences": [{"sent_id": f"{block_id}_s001", "text": text, "span": [0, len(text)]}],
        "quality_flags": ["ok"],
    }


def split_txt(raw: str) -> list[dict[str, Any]]:
    normalized = raw.replace("\r\n", "\n").replace("\r", "\n")
    parts = [part.strip() for part in re.split(r"\n\s*\n+", normalized) if part.strip()]
    chapters: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def new_chapter(title: str) -> dict[str, Any]:
        chapter = {"title": normalize_text(title), "items": []}
        chapters.append(chapter)
        return chapter

    for part in parts:
        text = normalize_text(part)
        if not text:
            continue
        if CHAPTER_RE.match(text):
            current = new_chapter(text)
            current["items"].append(("heading", text))
            continue
        if current is None:
            current = new_chapter("Chapter 1")
            current["items"].append(("heading", "Chapter 1"))
        current["items"].append((block_type_for(text), text))

    if not chapters:
        current = new_chapter("Chapter 1")
        current["items"].append(("heading", "Chapter 1"))
        current["items"].append(("paragraph", "Empty source"))

    return chapters


def _epub_rootfile(zf: zipfile.ZipFile) -> str:
    container = ET.fromstring(zf.read("META-INF/container.xml"))
    rootfile = container.find(".//{*}rootfile")
    if rootfile is None or not rootfile.attrib.get("full-path"):
        raise ProjectError("EPUB container does not declare a rootfile.")
    return rootfile.attrib["full-path"]


def _epub_spine_files(zf: zipfile.ZipFile, rootfile: str) -> list[str]:
    opf = ET.fromstring(zf.read(rootfile))
    base = Path(rootfile).parent
    manifest = {
        item.attrib.get("id"): item.attrib.get("href")
        for item in opf.findall(".//{*}manifest/{*}item")
    }
    files: list[str] = []
    for itemref in opf.findall(".//{*}spine/{*}itemref"):
        href = manifest.get(itemref.attrib.get("idref"))
        if href:
            files.append(str((base / href).as_posix()))
    return files


def split_epub(path: Path) -> list[dict[str, Any]]:
    chapters: list[dict[str, Any]] = []
    with zipfile.ZipFile(path) as zf:
        rootfile = _epub_rootfile(zf)
        for file_name in _epub_spine_files(zf, rootfile):
            if file_name not in zf.namelist():
                continue
            raw = zf.read(file_name).decode("utf-8", errors="replace")
            parser = BlockHTMLParser()
            parser.feed(raw)
            parser.close()
            items = [(block_type_for(text, tag), text) for tag, text in parser.blocks]
            if not items:
                continue
            heading = next((text for btype, text in items if btype == "heading"), Path(file_name).stem)
            if not any(btype == "heading" for btype, _ in items):
                items.insert(0, ("heading", heading))
            chapters.append({"title": heading, "items": items})
    if not chapters:
        raise ProjectError("No readable text blocks found in EPUB.")
    return chapters


def chapters_to_document(doc_id: str, metadata: dict[str, Any], chapters_raw: list[dict[str, Any]]) -> dict[str, Any]:
    chapters = []
    for cidx, source_chapter in enumerate(chapters_raw, 1):
        chapter_id = f"{doc_id}_ch{cidx:02d}"
        blocks = []
        opening_seen = False
        for bidx, (btype, text) in enumerate(source_chapter["items"], 1):
            opening = False
            if btype != "heading" and not opening_seen:
                opening = True
                opening_seen = True
            blocks.append(make_block(doc_id, chapter_id, bidx, text, btype, opening))
        chapters.append({
            "chapter_id": chapter_id,
            "order_index": cidx,
            "title": source_chapter.get("title") or f"Chapter {cidx}",
            "blocks": blocks,
        })
    return {
        "schema_version": SCHEMA_VERSION,
        "doc_id": doc_id,
        "metadata": metadata,
        "chapters": chapters,
    }


def load_project_metadata(project_path: Path) -> dict[str, Any]:
    meta_path = project_path / "working" / "project_meta.json"
    if meta_path.exists():
        return read_json(meta_path).get("metadata", {})
    document_path = project_path / "canonical" / DATASET_FILES["document"]
    if document_path.exists():
        return read_json(document_path).get("metadata", {})
    return {}


def write_empty_sidecars(project_path: Path) -> None:
    canonical = project_path / "canonical"
    for key in ("glossary", "entities", "chapter_summaries", "manual_reference_subset"):
        path = canonical / DATASET_FILES[key]
        if not path.exists():
            write_jsonl_atomic(path, [])


def write_job(project_path: Path, job: dict[str, Any]) -> None:
    path = project_path / "working" / "jobs" / f"{job['job_id']}.json"
    write_json_atomic(path, job)


def read_job(project_path: Path, job_id: str) -> dict[str, Any]:
    path = project_path / "working" / "jobs" / f"{job_id}.json"
    if not path.exists():
        raise ProjectError(f"Job not found: {job_id}")
    return read_json(path)


def extract_project(project_path: Path, doc_id: str, overwrite: bool = False, user: str = "local") -> dict[str, Any]:
    dirs = ensure_project_dirs(doc_id)
    ensure_working_files(project_path)
    source_path = find_source_file(project_path)
    if source_path is None:
        raise ProjectError("No TXT/EPUB source file found in raw/.")
    document_path = dirs["canonical"] / DATASET_FILES["document"]
    if document_path.exists() and not overwrite:
        raise ProjectError("Re-extracting can overwrite current document draft. Confirm overwrite first.")

    job_id = f"extract_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    job = {
        "job_id": job_id,
        "type": "extract",
        "status": "running",
        "started_at": now_iso(),
        "finished_at": None,
        "message": "",
    }
    write_job(project_path, job)

    try:
        if source_path.suffix.lower() == ".txt":
            raw = source_path.read_text(encoding="utf-8", errors="replace")
            chapters_raw = split_txt(raw)
        elif source_path.suffix.lower() == ".epub":
            chapters_raw = split_epub(source_path)
        else:
            raise ProjectError("Only .txt and .epub sources are supported in MVP.")
        metadata = default_metadata(doc_id, source_path, load_project_metadata(project_path))
        document = chapters_to_document(doc_id, metadata, chapters_raw)
        write_json_atomic(document_path, document)
        write_empty_sidecars(project_path)
        ensure_working_files(project_path, document)
        job.update({
            "status": "done",
            "finished_at": now_iso(),
            "message": f"Extracted {sum(len(ch['blocks']) for ch in document['chapters'])} blocks in {len(document['chapters'])} chapters",
            "document": {"chapters": len(document["chapters"]), "blocks": sum(len(ch["blocks"]) for ch in document["chapters"])},
        })
        write_job(project_path, job)
        log_event(project_path, "extract", {"job_id": job_id, "status": "done"}, user)
        return job
    except Exception as exc:
        job.update({"status": "failed", "finished_at": now_iso(), "message": str(exc)})
        write_job(project_path, job)
        log_event(project_path, "extract", {"job_id": job_id, "status": "failed", "message": str(exc)}, user)
        raise
