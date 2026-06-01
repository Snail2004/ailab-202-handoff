/* ===== PROJECT / SOURCE SCREEN: upload, metadata, extract ===== */

function ProjectSourceScreen({ docInfo, onPatchDoc, onBack, onExtract }) {
  const [fileName, setFileName] = React.useState("austen_pp.epub");
  const [confirmOverwrite, setConfirmOverwrite] = React.useState(false);
  const meta = docInfo.metadata || {};
  const prov = docInfo.provenance || {};
  const extracted = !!prov.extraction_tool;

  function patchMetadata(patch) {
    onPatchDoc({ metadata: { ...meta, ...patch } });
  }

  function startExtract() {
    if (extracted) setConfirmOverwrite(true);
    else onExtract(fileName);
  }

  return (
    <div className="project-screen">
      <div className="project-topbar">
        <div className="tb-left">
          <span className="tb-app"><span className="tb-logo">▧</span>AILAB <span className="tb-app-sub">Dataset Tool</span></span>
          <span className="tb-sep" />
          <span className="tb-doc"><Ic.folder size={13} className="faint" /><span className="mono">{docInfo.doc_id}</span></span>
        </div>
        <div className="tb-right">
          <button className="btn" onClick={onBack}><Ic.arrowRight size={13} style={{ transform: "rotate(180deg)" }} />Back to workspace</button>
        </div>
      </div>

      <div className="project-wrap">
        <div className="project-headline">
          <div>
            <div className="project-kicker">Project / Source</div>
            <h1>Prepare source metadata before annotation</h1>
            <p>Upload a TXT/EPUB source, record provenance, then run extraction. Re-extracting requires confirmation because it can overwrite the current document draft.</p>
          </div>
          <div className="source-state">
            <div className="srcstat-row"><span className="ss-dot ok" /><span className="ss-label">Source</span><span className="ss-val mono">{fileName || "not selected"}</span></div>
            <div className="srcstat-row"><span className={"ss-dot " + (extracted ? "ok" : "bad")} /><span className="ss-label">Extracted</span><span className="ss-val mono">{extracted ? "14 blocks · 2 ch" : "not yet"}</span></div>
            <div className="srcstat-row"><span className="ss-dot bad" /><span className="ss-label">Validation</span><span className="ss-val mono bad">2 errors</span></div>
          </div>
        </div>

        <div className="project-grid">
          <section className="project-panel">
            <div className="panel-title"><Ic.doc size={14} />Metadata / provenance</div>
            <div className="project-form">
              <FormField label="title"><input value={meta.title || ""} onChange={e => patchMetadata({ title: e.target.value })} /></FormField>
              <FormField label="author"><input value={meta.author || ""} onChange={e => patchMetadata({ author: e.target.value })} /></FormField>
              <FormField label="domain"><input value={meta.domain || ""} onChange={e => patchMetadata({ domain: e.target.value })} /></FormField>
              <FormField label="genre"><input value={meta.genre || ""} onChange={e => patchMetadata({ genre: e.target.value })} /></FormField>
              <FormField label="source_format">
                <select value={meta.source_format || "epub"} onChange={e => patchMetadata({ source_format: e.target.value })}>
                  <option value="epub">epub</option>
                  <option value="txt">txt</option>
                  <option value="html">html</option>
                  <option value="pdf">pdf (logical extraction only)</option>
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
              <span className="lockfield"><span className="lf-k"><Ic.lock size={9} />raw_sha256</span><span className="lf-v">{prov.raw_sha256 || "created after extract"}</span></span>
              <span className="lockfield"><span className="lf-k"><Ic.lock size={9} />pipeline</span><span className="lf-v">{prov.pipeline_version || "pending"}</span></span>
            </div>
          </section>

          <section className="project-panel">
            <div className="panel-title"><Ic.upload size={14} />Source file</div>
            <div className="source-drop">
              <Ic.file size={22} />
              <div>
                <div className="source-drop-title">TXT / EPUB source</div>
                <div className="source-drop-sub">Prototype state only. Backend upload is wired later.</div>
              </div>
              <input value={fileName} onChange={e => setFileName(e.target.value)} />
            </div>
            <div className="extract-actions">
              <button className="btn" onClick={() => setFileName("")}>Clear</button>
              <button className="btn primary" onClick={startExtract}><Ic.play size={13} />Extract</button>
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
            <button className="btn primary" onClick={() => { setConfirmOverwrite(false); onExtract(fileName); }}>Overwrite draft</button>
          </>}>
          <p>Re-extracting can overwrite <span className="mono">document.json</span> and invalidate edited clean text, spans, and review state.</p>
          <p className="muted">Use this only when the source file or extraction settings changed.</p>
        </Modal>
      )}
    </div>
  );
}

window.ProjectSourceScreen = ProjectSourceScreen;
