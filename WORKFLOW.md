# AILAB WORKFLOW — Quy trình & phân vai cho nhóm (AIL-202)

> **Phạm vi:** SOP vận hành cho nhóm AI-LAB xây bộ dữ liệu dịch EN→VI văn bản dài. Nhóm KHÔNG làm hệ agent/app dịch. "Dịch" trong AI-LAB = **reference VI đã kiểm duyệt theo năng lực**: có mức tối thiểu để chứng minh quy trình, sau đó dịch/verify được càng nhiều càng tốt.
> Chuẩn format: `dataset/schema/` (schema **1.4.0**) + `dataset/tools/validate.py`. Kế hoạch: `AILAB_PLAN.md`.

## 1. Hai công cụ (tách bạch)
| Công cụ | Ai dùng | Làm gì |
|---|---|---|
| **Python extraction pipeline** (CLI) | 1–2 bạn tooling | PDF/EPUB/TXT/HTML → `document.json` **nháp** (validate pass). Member khác không chạy |
| **Web app** (review/annotation) | **Cả nhóm** | Sửa `clean_text`, metadata, annotation, chapter summary, reference VI; validate inline; export JSON |

**Không ai sửa JSON bằng tay.** Web app là "mặt bàn làm việc chung"; **`validate.py` là cổng chốt** (web validate chỉ để phản hồi nhanh).

## 2. Phân quyền field
**Read-only (pipeline sinh, không cho sửa qua web):**
`doc_id`, `chapter_id`, `block_id`, `order_index`, `source_text`, `raw_sha256`, `source_url`, `extraction_tool`, `pipeline_version`, `provenance.raw_span`.

**Editable (annotator):**
metadata mô tả (`title`, `author`, `genre`, `domain`); block (`clean_text`, `block_type`, `is_chapter_opening`, `quality_flags`); annotation (term/entity/discourse/motif/tone/note); `chapter_summaries.jsonl`; `manual_reference_subset.jsonl`.

**Chỉ Reviewer/Lead:**
`metadata.license`, `metadata.contamination_risk`; promote glossary `status` → `locked/human_verified`; **duyệt `reviewed`/`locked` để vào freeze**.

## 2.1. Field ownership: code / AI draft / human review

Schema 1.4.0 không có nghĩa là một agent phải tự điền tất cả field. Mỗi nhóm field có executor đúng:

| Field / task | Executor chính | Quy tắc |
|---|---|---|
| `doc_id`, `chapter_id`, `block_id`, `order_index` | Code/pipeline | Sinh tất định, annotator không sửa tay |
| `source_text`, `raw_sha256`, `source_url`, extraction provenance | Code/pipeline | Read-only; dùng để trace source |
| `clean_text`, `block_type`, `is_chapter_opening`, `quality_flags` | Code draft + annotator review | Tool có thể gợi ý; người sửa khi sai |
| `sentences[]`, `span`, term/entity mention spans | Code hoặc UI selection | Không giao LLM đếm offset ký tự |
| Glossary/entity candidates, aliases, `characters_present` | AI draft + annotator verify | LLM chỉ nháp; human chốt canonical target/status |
| `chapter_summaries.summary_source` | AI/human draft + reviewer verify | Viết ngay sau khi review xong chương |
| `motifs`, `tone`, `implicit_meaning`, `narrative_note` | Optional hint | Chỉ điền khi rõ; không bắt điền cho mọi block |
| `reference_vi` | Human-owned + review chéo | Raw AI output không bao giờ là gold reference |
| license, contamination risk, freeze status | Lead/Reviewer | Chỉ Lead/Reviewer được sign-off |

Validator chỉ kiểm cấu trúc/id/span/cross-reference. Validator pass không chứng minh summary, tone, ẩn ý hay bản dịch đúng về nội dung; phần đó phải qua review.

### 2.2. Các điểm dễ fail và lớp chặn

| Rủi ro | Lớp chặn |
|---|---|
| LLM bịa `span`/offset | Span do code hoặc UI selection sinh; không cho LLM tự đếm |
| Ref treo hoặc id trùng | `validate.py` kiểm cross-file references và duplicate id |
| Agent thêm field lạ/sai enum | Schema có `additionalProperties:false`; chạy validate trước freeze |
| Glossary/entity không nhất quán | Human verify/lock canonical target, variants và pronoun policy |
| Metadata narrative bị suy diễn | Chỉ điền khi có evidence; không rõ thì để `[]`/`null` |
| Raw AI translation lọt vào reference | Draft ở CSV; JSONL chỉ nhận `reviewed`/`locked` |

## 3. Phân vai (không gán tên)
| Vai | Trách nhiệm |
|---|---|
| **Source/Provenance** | chọn nguồn, verify license, lưu raw + sha256 |
| **Pipeline (tooling)** | chạy extraction → draft JSON; bảo trì schema/validator/web tool |
| **Metadata/Cleaning** | sửa `clean_text`, `block_type`, `quality_flags` |
| **Annotation** | term/entity/discourse + chapter summaries |
| **Translation reference** | dịch/verify reference VI theo năng lực (người song ngữ) |
| **Reviewer/QC** | review chéo, đo IAA, chạy validator, ghi QC report |
| **Lead** | sở hữu schema, sign-off license/metadata, **gác cổng freeze** |

## 4. Quy trình dịch reference VI
- **Phạm vi:** bắt đầu bằng một tập tối thiểu **stratified** cho nguồn MVP (chapter-opening / dialogue / term-entity-rich / narrative-khó / random), sau đó dịch/verify được tới đâu thì đưa vào tới đó. Càng nhiều reference VI đã review càng tốt. **Không bắt buộc parallel toàn bộ**, nhưng nếu nhóm dịch được gần/toàn bộ nguồn thì vẫn hợp lệ khi mọi dòng đều reviewed/locked.
- **AI policy:** AI chỉ là **draft/gợi ý**. `reference_vi` cuối **phải do người song ngữ sửa** và **người thứ 2 review**. **Raw AI output không bao giờ là gold reference.**
- **Vòng đời (lifecycle 3 trạng thái):**
  - `draft` → nằm ở **`translation_review_log.csv`** (working file, không validate).
  - `reviewed` → đã review chéo → **mới được ghi vào `manual_reference_subset.jsonl`**.
  - `locked` → đã chốt cuối.
- **Schema 1.4.0:** mỗi dòng reference bắt buộc có `source` (`human`|`ai_assisted_verified`) + `status` (`reviewed`|`locked`). File JSONL **freeze-clean**: không chứa `draft`.

### Working log: `translation_review_log.csv`
Cột: `reference_id, block_id, source_text, draft_vi, final_reference_vi, method, ai_model, prompt_id, translated_by, reviewed_by, status, notes`
- `method`: `human` | `ai_assisted`. Khi lên JSONL: `human → source=human`; `ai_assisted (đã verify) → source=ai_assisted_verified`.
- Chỉ dòng `status = reviewed` hoặc `locked` mới chuyển sang `manual_reference_subset.jsonl`.

## 5. Luồng làm việc chuẩn cho mỗi nguồn
```text
Nguồn thật (license OK)
→ Python extraction → draft document.json (validate pass)
→ web review: clean_text + metadata
→ annotate: term/entity/discourse + chapter summary (viết NGAY sau mỗi chương)
→ chọn reference blocks → dịch reference VI (CSV draft)
→ review chéo → reviewed → đưa vào manual_reference_subset.jsonl
→ validate.py PASS  (cổng chính thức)
→ freeze dataset version + CHANGELOG
```

## 6. Đầu ra yêu cầu
**Mỗi nguồn `<doc_id>/`:**
```text
document.json                  (bắt buộc, validate pass, provenance/license đủ)
glossary.jsonl                 (bắt buộc nguồn MVP)
entities.jsonl                 (bắt buộc nguồn MVP)
chapter_summaries.jsonl        (summary_source + source mỗi chương)
manual_reference_subset.jsonl  (reference VI đã review; tối thiểu stratified, mở rộng càng nhiều càng tốt)
```
**Cấp dataset (deliverable nhóm):** `README.md`/data dictionary, `LICENSE_NOTES.md`, `CHANGELOG.md`/`versions.json`, annotation guidelines, pipeline code + run guide, IAA report, QC report/validation result.

## 7. Definition of Done (mỗi nguồn)
- [ ] `validate.py` **PASS** (exit 0).
- [ ] 4-eyes review toàn bộ + IAA trên ~15–20% overlap (có số).
- [ ] Provenance/license đầy đủ trong `metadata` + `LICENSE_NOTES.md`.
- [ ] Reference VI: mọi dòng `source`+`status`, chỉ `reviewed/locked`; dịch tới đâu review tới đó, không đưa draft vào JSONL.
- [ ] AI-touch (nếu có) ghi rõ (`source=ai_assisted_verified` + `ai_model/prompt_id/ai_used_at`).
- [ ] **Freeze version + CHANGELOG entry.**

## 8. Chính sách AI (tóm tắt)
- AI **được** dùng làm draft cho dịch reference + nháp metadata narrative.
- **Bắt buộc** người sửa + người review trước khi vào freeze.
- **Bắt buộc** ghi provenance AI (source/model/prompt/date).
- **Cấm** đưa raw AI output vào freeze như gold.
- Nếu làm "demo dịch đầy đủ bằng AI": **tách riêng, dán nhãn rõ, KHÔNG vào freeze/eval**.

---
*SOP cho nhóm AI-LAB. Schema 1.4.0. Không phải hệ agent/app dịch.*
