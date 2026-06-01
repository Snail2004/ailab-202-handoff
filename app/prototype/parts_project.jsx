/* ===== PROJECT / SOURCE SCREEN: project selection, upload, metadata, extract ===== */

function ProjectSourceScreen({
  projects,
  activeDocId,
  docInfo,
  chapters,
  blocks,
  errors,
  onSelectProject,
  onCreateProject,
  onPatchDoc,
  onUploadSource,
  onBack,
  onExtract,
}) {
  const [file, setFile] = React.useState(null);
  const [confirmOverwrite, setConfirmOverwrite] = React.useState(false);
  const [newDocId, setNewDocId] = React.useState("");
  const meta = docInfo.metadata || {};
  const prov = docInfo.provenance || {};
  const extracted = blocks.length > 0;
  const selectedProject = projects.find(p => p.doc_id === activeDocId);

  function patchMetadata(patch) {
    onPatchDoc({ metadata: patch });
  }

  async function createFromForm() {
    const docId = newDocId.trim();
    if (!docId) return;
    const created = await onCreateProject(docId, {
      title: meta.title || docId,
      author: meta.author || "",
      domain: meta.domain || "literature",
      genre: meta.genre || "novel",
      source_format: meta.source_format || "txt",
      license: meta.license || "",
      source_url: meta.source_url || "",
      contamination_risk: meta.contamination_risk || "low",
    });
    if (created) setNewDocId("");
  }

  async function uploadSelected() {
    if (!file) return;
    await onUploadSource(file, false);
  }

  function startExtract() {
    if (extracted) setConfirmOverwrite(true);
    else onExtract(false);
  }

  return (
    <div className="project-screen">
      <div className="project-topbar">
        <div className="tb-left">
          <span className="tb-app"><span className="tb-logo">▧</span>AILAB <span className="tb-app-sub">Dataset Tool</span></span>
          <span className="tb-sep" />
          <span className="tb-doc"><Ic.folder size={13} className="faint" /><span className="mono">{activeDocId || "no_project"}</span></span>
        </div>
        <div className="tb-right">
          <button className="btn" onClick={onBack} disabled={!extracted}><Ic.arrowRight size={13} style={{ transform: "rotate(180deg)" }} />Back to workspace</button>
        </div>
      </div>

      <div className="project-wrap">
        <div className="project-headline">
          <div>
            <div className="project-kicker">Project / Source</div>
            <h1>Prepare source metadata before annotation</h1>
            <p>Choose a local project, upload a TXT/EPUB source, record source metadata, then run extraction. Re-extracting requires confirmation because it can overwrite the current document draft.</p>
          </div>
          <div className="source-state">
            <div className="srcstat-row"><span className={"ss-dot " + (selectedProject ? "ok" : "bad")} /><span className="ss-label">Project</span><span className="ss-val mono">{activeDocId || "not selected"}</span></div>
            <div className="srcstat-row"><span className={"ss-dot " + (extracted ? "ok" : "bad")} /><span className="ss-label">Extracted</span><span className="ss-val mono">{extracted ? `${blocks.length} blocks · ${chapters.length} ch` : "not yet"}</span></div>
            <div className="srcstat-row"><span className={"ss-dot " + (errors.length ? "bad" : "ok")} /><span className="ss-label">Validation</span><span className={"ss-val mono " + (errors.length ? "bad" : "")}>{errors.length ? `${errors.length} issue(s)` : "no report issues"}</span></div>
          </div>
        </div>

        <div className="project-grid">
          <section className="project-panel">
            <div className="panel-title"><Ic.folder size={14} />Local project</div>
            <div className="project-form">
              <FormField label="open project">
                <select value={activeDocId || ""} onChange={e => onSelectProject(e.target.value)}>
                  {projects.map(p => <option key={p.doc_id} value={p.doc_id}>{p.doc_id} · {p.status}</option>)}
                </select>
              </FormField>
              <FormField label="new doc_id">
                <input value={newDocId} placeholder="my_novel_01" onChange={e => setNewDocId(e.target.value)} />
              </FormField>
              <button className="btn" onClick={createFromForm}><Ic.plus size={13} />Create project</button>
            </div>
          </section>

          <section className="project-panel">
            <div className="panel-title"><Ic.doc size={14} />Metadata / provenance</div>
            <div className="project-form">
              <FormField label="title"><input value={meta.title || ""} onChange={e => patchMetadata({ title: e.target.value })} /></FormField>
              <FormField label="author"><input value={meta.author || ""} onChange={e => patchMetadata({ author: e.target.value })} /></FormField>
              <FormField label="domain"><input value={meta.domain || ""} onChange={e => patchMetadata({ domain: e.target.value })} /></FormField>
              <FormField label="genre"><input value={meta.genre || ""} onChange={e => patchMetadata({ genre: e.target.value })} /></FormField>
              <FormField label="source_format">
                <select value={meta.source_format || "txt"} onChange={e => patchMetadata({ source_format: e.target.value })}>
                  <option value="txt">txt</option>
                  <option value="epub">epub</option>
                  <option value="html">html</option>
                  <option value="pdf">pdf (not extractable in MVP)</option>
                </select>
              </FormField>
              <FormField label="license"><input value={meta.license || ""} onChange={e => patchMetadata({ license: e.target.value })} /></FormField>
              <FormField label="source_url"><input value={meta.source_url || ""} onChange={e => patchMetadata({ source_url: e.target.value })} /></FormField>
              <FormField label="contamination_risk">
                <select value={meta.contamination_risk || ""} onChange={e => patchMetadata({ contamination_risk: e.target.value })}>
                  <option value="">not set</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </FormField>
            </div>
            <div className="readonly-strip">
              <span className="lockfield"><span className="lf-k"><Ic.lock size={9} />raw_sha256</span><span className="lf-v">{prov.raw_sha256 || meta.raw_sha256 || "created after extract"}</span></span>
              <span className="lockfield"><span className="lf-k"><Ic.lock size={9} />pipeline</span><span className="lf-v">{prov.pipeline_version || meta.pipeline_version || "pending"}</span></span>
            </div>
          </section>

          <section className="project-panel">
            <div className="panel-title"><Ic.upload size={14} />Source file</div>
            <div className="source-drop">
              <Ic.file size={22} />
              <div>
                <div className="source-drop-title">TXT / EPUB source</div>
                <div className="source-drop-sub">Backend rejects PDF/OCR/layout extraction in this MVP.</div>
              </div>
              <input type="file" accept=".txt,.epub" onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="extract-actions">
              <button className="btn" onClick={() => setFile(null)}>Clear</button>
              <button className="btn" disabled={!file || !activeDocId} onClick={uploadSelected}><Ic.upload size={13} />Upload source</button>
              <button className="btn primary" disabled={!activeDocId} onClick={startExtract}><Ic.play size={13} />Extract</button>
            </div>
            <div className="extract-note">
              <Ic.alert size={12} />
              <span>Extract only lives here, not in the annotation workspace. Re-extracting can discard reviewed edits.</span>
            </div>
          </section>
        </div>
      </div>

      {confirmOverwrite && (
        <Modal title="Confirm re-extract" icon={Ic.alert} tone="bad" onClose={() => setConfirmOverwrite(false)}
          actions={<>
            <button className="btn" onClick={() => setConfirmOverwrite(false)}>Cancel</button>
            <button className="btn primary" onClick={() => { setConfirmOverwrite(false); onExtract(true); }}>Overwrite draft</button>
          </>}>
          <p>Re-extracting can overwrite <span className="mono">document.json</span> and invalidate edited clean text, spans, and review state.</p>
          <p className="muted">Use this only when the source file or extraction settings changed.</p>
        </Modal>
      )}
    </div>
  );
}

window.ProjectSourceScreen = ProjectSourceScreen;
