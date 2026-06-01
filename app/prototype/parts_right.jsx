/* ===== RIGHT PANEL: accordion of 6 tabs, one expanded at a time ===== */

function StatusPill({ status }) {
  const map = {
    locked: ["Locked", "pill-lock"],
    proposed: ["Proposed", "pill-amber"],
    human_verified: ["Verified", "pill-green"],
    reviewed: ["Reviewed", "pill-green"],
    draft: ["Draft", "pill-amber"],
  };
  const [label, cls] = map[status] || [status || "Unset", "pill-grey"];
  return <span className={"pill " + cls}>{label}</span>;
}

function MiniField({ label, children, locked }) {
  return (
    <div className="mf">
      <div className="mf-label">{locked && <Ic.lock size={9} />}{label}</div>
      <div className="mf-val">{children}</div>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      {children}
    </label>
  );
}

function csvToArray(value) {
  return value.split(",").map(x => x.trim()).filter(Boolean);
}

function arrayToCsv(value) {
  return (value || []).join(", ");
}

/* ---------- GLOSSARY ---------- */
function GlossaryTab({ terms, onDeleteTerm, onUpdateTerm }) {
  const [expanded, setExpanded] = React.useState(terms[0]?.term_id);
  React.useEffect(() => {
    if (terms.length && !terms.some(t => t.term_id === expanded)) setExpanded(terms[0].term_id);
  }, [terms, expanded]);

  if (!terms.length) {
    return <Empty icon={Ic.tag} text="No glossary terms for this block." sub="Select text in Clean text -> Add glossary term." />;
  }

  return (
    <div className="tab-body">
      {terms.map(t => {
        const open = expanded === t.term_id;
        return (
          <div key={t.term_id} className={"card" + (open ? " open" : "")}>
            <button className="card-head" onClick={() => setExpanded(open ? null : t.term_id)}>
              <Ic.chevRight size={11} className="card-caret" style={{ transform: open ? "rotate(90deg)" : "none" }} />
              <span className="card-title mono">{t.source_term || "(new term)"}</span>
              <span className="card-arrow"><Ic.arrowRight size={11} /></span>
              <span className="card-target">{t.expected_target || "target needed"}</span>
              <span className="card-spacer" />
              <StatusPill status={t.status} />
            </button>
            {open && (
              <div className="card-body">
                <div className="form-grid">
                  <FormField label="source_term">
                    <input value={t.source_term || ""} onChange={e => onUpdateTerm(t.term_id, { source_term: e.target.value })} />
                  </FormField>
                  <FormField label="expected_target">
                    <input value={t.expected_target || ""} onChange={e => onUpdateTerm(t.term_id, { expected_target: e.target.value })} />
                  </FormField>
                  <FormField label="allowed_variants">
                    <input value={arrayToCsv(t.allowed_variants)} onChange={e => onUpdateTerm(t.term_id, { allowed_variants: csvToArray(e.target.value) })} />
                  </FormField>
                  <FormField label="forbidden_variants">
                    <input value={arrayToCsv(t.forbidden_variants)} onChange={e => onUpdateTerm(t.term_id, { forbidden_variants: csvToArray(e.target.value) })} />
                  </FormField>
                  <FormField label="status">
                    <select value={t.status || "proposed"} onChange={e => onUpdateTerm(t.term_id, { status: e.target.value })}>
                      <option value="proposed">proposed</option>
                      <option value="human_verified">human_verified</option>
                      <option value="locked">locked</option>
                    </select>
                  </FormField>
                </div>
                <div className="card-meta-row">
                  <span className="lockfield"><span className="lf-k"><Ic.lock size={9} />scope</span><span className="lf-v">{t.chapter_scope}</span></span>
                  <span className="lockfield"><span className="lf-k">conf</span><span className="lf-v">{Number(t.confidence || 0).toFixed(2)}</span></span>
                  <span className="lockfield"><span className="lf-k">occ</span><span className="lf-v">{t.occurrences.length}</span></span>
                  <button className="card-del tip tip-left" data-tip="Delete term" onClick={() => onDeleteTerm(t)}><Ic.trash size={12} /></button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- ENTITIES ---------- */
function EntitiesTab({ entities, allEntities, block, onUpdateEntity, onUpdateDiscourse }) {
  const [expanded, setExpanded] = React.useState(entities[0]?.entity_id);
  React.useEffect(() => {
    if (entities.length && !entities.some(e => e.entity_id === expanded)) setExpanded(entities[0].entity_id);
  }, [entities, expanded]);

  if (!entities.length && block.block_type !== "dialogue") {
    return <Empty icon={Ic.users} text="No entities mentioned in this block." sub="Select text in Clean text -> Add entity mention." />;
  }

  const isDialogue = block.block_type === "dialogue";
  return (
    <div className="tab-body">
      {isDialogue && (
        <div className="discourse">
          <div className="discourse-head"><Ic.quote size={11} />dialogue · speaker / addressee</div>
          <div className="discourse-row">
            <DiscSelect label="speaker" entities={allEntities} value={block.discourse?.speaker_entity_id || ""}
              onChange={value => onUpdateDiscourse({ speaker_entity_id: value })} />
            <DiscSelect label="addressee" entities={allEntities} value={block.discourse?.addressee_entity_id || ""}
              onChange={value => onUpdateDiscourse({ addressee_entity_id: value })} />
          </div>
        </div>
      )}

      {!entities.length && <Empty icon={Ic.users} text="No entity mentions in this block yet." sub="Dialogue speaker/addressee can still be set above." />}

      {entities.map(e => {
        const open = expanded === e.entity_id;
        const mentions = e.mentions.filter(m => m.block_id === block.block_id);
        return (
          <div key={e.entity_id} className={"card" + (open ? " open" : "")}>
            <button className="card-head" onClick={() => setExpanded(open ? null : e.entity_id)}>
              <Ic.chevRight size={11} className="card-caret" style={{ transform: open ? "rotate(90deg)" : "none" }} />
              <span className={"ent-type ent-" + e.entity_type}>{(e.entity_type || "?")[0]}</span>
              <span className="card-title">{e.canonical_source || "(new entity)"}</span>
              <span className="card-arrow"><Ic.arrowRight size={11} /></span>
              <span className="card-target">{e.canonical_target || "target needed"}</span>
              <span className="card-spacer" />
              {mentions.length > 0 && <span className="ment-count mono">{mentions.length}x</span>}
            </button>
            {open && (
              <div className="card-body">
                <div className="form-grid">
                  <FormField label="canonical_source">
                    <input value={e.canonical_source || ""} onChange={ev => onUpdateEntity(e.entity_id, { canonical_source: ev.target.value })} />
                  </FormField>
                  <FormField label="canonical_target">
                    <input value={e.canonical_target || ""} onChange={ev => onUpdateEntity(e.entity_id, { canonical_target: ev.target.value })} />
                  </FormField>
                  <FormField label="aliases_target">
                    <input value={arrayToCsv(e.aliases_target)} onChange={ev => onUpdateEntity(e.entity_id, { aliases_target: csvToArray(ev.target.value) })} />
                  </FormField>
                  <FormField label="pronoun_policy">
                    <input value={e.pronoun_policy || ""} onChange={ev => onUpdateEntity(e.entity_id, { pronoun_policy: ev.target.value })} />
                  </FormField>
                </div>
                {mentions.length > 0 && (
                  <MiniField label="mentions in this block">
                    {mentions.map((m, i) => <span key={i} className="var mono">"{m.surface}" [{m.span[0]},{m.span[1]}]</span>)}
                  </MiniField>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DiscSelect({ label, entities, value, onChange }) {
  return (
    <label className="disc-field">
      <span className="disc-label">{label}</span>
      <div className="disc-sel">
        <select value={value || ""} onChange={e => onChange(e.target.value)}>
          <option value="">-</option>
          {entities.map(e => <option key={e.entity_id} value={e.entity_id}>{e.canonical_source}</option>)}
        </select>
        <Ic.chevDown size={11} className="faint" />
      </div>
    </label>
  );
}

/* ---------- SUMMARY ---------- */
function SummaryTab({ summary, entities, onUpdateSummary }) {
  const safe = summary || {};
  return (
    <div className="tab-body">
      <div className="sum-meta">
        <span className="lockfield"><span className="lf-k">chapter</span><span className="lf-v">{safe.chapter_id || "-"}</span></span>
        <span className="lockfield"><span className="lf-k">conf</span><span className="lf-v">{Number(safe.confidence || 0).toFixed(2)}</span></span>
      </div>
      <FormField label="summary_source">
        <textarea rows={5} value={safe.summary_source || ""} onChange={e => onUpdateSummary(safe.chapter_id, { summary_source: e.target.value })} />
      </FormField>
      <div className="form-grid">
        <FormField label="source">
          <select value={safe.source || ""} onChange={e => onUpdateSummary(safe.chapter_id, { source: e.target.value })}>
            <option value="">not set</option>
            <option value="human">human</option>
            <option value="ai_assisted_verified">ai_assisted_verified</option>
          </select>
        </FormField>
        <FormField label="emotional_tone">
          <input value={safe.emotional_tone || ""} onChange={e => onUpdateSummary(safe.chapter_id, { emotional_tone: e.target.value })} />
        </FormField>
        <FormField label="setting">
          <input value={safe.setting || ""} onChange={e => onUpdateSummary(safe.chapter_id, { setting: e.target.value })} />
        </FormField>
      </div>
      <MiniField label="characters_present">
        {(safe.characters_present || []).length ? safe.characters_present.map(id => {
          const e = entities.find(x => x.entity_id === id);
          return <span key={id} className="var mono">{e ? e.canonical_source : id}</span>;
        }) : <span className="faint">none</span>}
      </MiniField>
    </div>
  );
}

/* ---------- REFERENCE ---------- */
function ReferenceTab({ refs, block, onUpdateReference, onSaveDraft, onMarkReviewed, onLockReference }) {
  const blockRef = refs.find(r => r.block_id === block.block_id);
  return (
    <div className="tab-body">
      <div className="ref-explain">
        <Ic.layers size={12} />
        <span><b>Draft</b> stays in working state. Only <b>Reviewed</b> or <b>Locked</b> references are freeze-eligible.</span>
      </div>
      {!blockRef ? (
        <Empty icon={Ic.book} text="No reference translation for this block." sub="This block is not in the reference subset stratum." />
      ) : (
        <div className={"ref-card status-" + blockRef.status}>
          <div className="ref-card-head">
            <span className="ref-stratum mono">{blockRef.stratum}</span>
            <span className="card-spacer" />
            <StatusPill status={blockRef.status} />
            {blockRef.canonical && <span className="pill pill-lock"><Ic.lock size={9} />canonical</span>}
          </div>

          <FormField label="reference_vi">
            <textarea className="ref-textarea" rows={6} value={blockRef.reference_vi || ""}
              disabled={blockRef.status === "locked"}
              onChange={e => onUpdateReference(blockRef.reference_id, { reference_vi: e.target.value, canonical: false })} />
          </FormField>

          <div className="form-grid">
            <FormField label="source">
              <select value={blockRef.source || ""} disabled={blockRef.status === "locked"}
                onChange={e => onUpdateReference(blockRef.reference_id, { source: e.target.value, canonical: false })}>
                <option value="">not set</option>
                <option value="human">human</option>
                <option value="ai_assisted_verified">ai_assisted_verified</option>
              </select>
            </FormField>
            <FormField label="ai_model">
              <input value={blockRef.ai_model || ""} disabled={blockRef.status === "locked"}
                onChange={e => onUpdateReference(blockRef.reference_id, { ai_model: e.target.value, canonical: false })} />
            </FormField>
          </div>

          <div className="ref-foot">
            <span className="lockfield"><span className="lf-k">by</span><span className="lf-v">{blockRef.translated_by}</span></span>
            {blockRef.reviewed_by && <span className="lockfield"><span className="lf-k">reviewed</span><span className="lf-v">{blockRef.reviewed_by}</span></span>}
            {blockRef.ai_model && <span className="lockfield"><span className="lf-k"><Ic.sparkle size={9} />model</span><span className="lf-v">{blockRef.ai_model}</span></span>}
          </div>

          <div className="ref-actions">
            <button className="btn sm" disabled={blockRef.status === "locked"} onClick={() => onSaveDraft(blockRef.reference_id)}>Save draft</button>
            <button className="btn sm" disabled={blockRef.status === "locked"} onClick={() => onMarkReviewed(blockRef.reference_id)}><Ic.checkCircle size={12} />Mark reviewed</button>
            <button className="btn sm primary" disabled={blockRef.status !== "reviewed"} onClick={() => onLockReference(blockRef.reference_id)}><Ic.lock size={12} />Lock</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- VALIDATE ---------- */
function ValidateTab({ errors, onJump }) {
  const byFile = {};
  errors.forEach(e => { (byFile[e.file] = byFile[e.file] || []).push(e); });
  const files = Object.keys(byFile);
  if (!files.length) return <Empty icon={Ic.checkCircle} text="No validation errors." sub="All checks pass - freeze still requires review gates." good />;
  return (
    <div className="tab-body">
      {files.map(f => (
        <div key={f} className="val-group">
          <div className="val-file"><Ic.file size={12} />{f}<span className="val-count mono">{byFile[f].length}</span></div>
          {byFile[f].map((e, i) => (
            <button key={i} className={"val-row sev-" + e.severity} onClick={() => onJump(e)}>
              <span className={"val-sev sev-" + e.severity}>{e.severity === "error" ? <Ic.xCircle size={12} /> : <Ic.alert size={12} />}</span>
              <span className="val-text">
                <span className="val-msg">{e.message}</span>
                <span className="val-loc mono">{e.block_id || e.chapter_id || "-"} · {e.location}</span>
              </span>
              {e.block_id && <span className="val-jump">jump <Ic.arrowRight size={11} /></span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- PROGRESS ---------- */
function Bar({ label, done, total, tone }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="prog-row">
      <div className="prog-top"><span className="prog-label">{label}</span><span className="prog-num mono">{done}/{total}</span></div>
      <div className="prog-track"><div className={"prog-fill " + (tone || "")} style={{ width: pct + "%" }} /></div>
    </div>
  );
}

function ProgressTab({ stats, freezeReasons }) {
  return (
    <div className="tab-body">
      <Bar label="Blocks reviewed" done={stats.reviewed} total={stats.totalBlocks} />
      <Bar label="Glossary terms" done={stats.glossaryDone} total={stats.glossary} tone="alt" />
      <Bar label="Entities resolved" done={stats.entitiesDone} total={stats.entities} tone="alt" />
      <Bar label="Chapter summaries" done={stats.summaries} total={stats.totalChapters} tone="alt" />
      <Bar label="Reference subset reviewed/locked" done={stats.refReviewed} total={stats.refs} tone="alt" />
      <Bar label="Validation clean" done={stats.valClean} total={stats.valTotal} tone={stats.valClean === stats.valTotal ? "good" : "bad"} />
      <div className="prog-note">
        <Ic.snow size={12} />
        <span>{freezeReasons.length ? "Freeze is blocked: " + freezeReasons.join("; ") : "Freeze gates are clear."}</span>
      </div>
    </div>
  );
}

function Empty({ icon: I, text, sub, good }) {
  return (
    <div className={"empty" + (good ? " good" : "")}>
      <I size={20} className="empty-ic" />
      <div className="empty-text">{text}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  );
}

const TABS = [
  { id: "glossary", label: "Glossary", icon: Ic.tag },
  { id: "entities", label: "Entities", icon: Ic.users },
  { id: "summary", label: "Summary", icon: Ic.doc },
  { id: "reference", label: "Reference", icon: Ic.book },
  { id: "validate", label: "Validate", icon: Ic.checkCircle },
  { id: "progress", label: "Progress", icon: Ic.layers },
];

function RightPanel({ active, onSetActive, counts, ctx }) {
  return (
    <div className="col col-right">
      <div className="rp-accordion">
        {TABS.map(t => {
          const open = active === t.id;
          const I = t.icon;
          const badge = counts[t.id];
          return (
            <div key={t.id} className={"rp-sec" + (open ? " open" : "")}>
              <button className="rp-head" onClick={() => onSetActive(t.id)}>
                <Ic.chevRight size={12} className="rp-caret" style={{ transform: open ? "rotate(90deg)" : "none" }} />
                <I size={13} className="rp-ic" />
                <span className="rp-label">{t.label}</span>
                <span className="rp-spacer" />
                {badge != null && badge.text && (
                  <span className={"rp-badge" + (badge.tone ? " " + badge.tone : "")}>{badge.text}</span>
                )}
              </button>
              {open && (
                <div className="rp-content">
                  {t.id === "glossary" && <GlossaryTab terms={ctx.terms} onDeleteTerm={ctx.onDeleteTerm} onUpdateTerm={ctx.onUpdateTerm} />}
                  {t.id === "entities" && <EntitiesTab entities={ctx.entities} allEntities={ctx.allEntities} block={ctx.block} onUpdateEntity={ctx.onUpdateEntity} onUpdateDiscourse={ctx.onUpdateDiscourse} />}
                  {t.id === "summary" && <SummaryTab summary={ctx.summary} entities={ctx.allEntities} onUpdateSummary={ctx.onUpdateSummary} />}
                  {t.id === "reference" && <ReferenceTab refs={ctx.references} block={ctx.block} onUpdateReference={ctx.onUpdateReference} onSaveDraft={ctx.onSaveDraft} onMarkReviewed={ctx.onMarkReviewedReference} onLockReference={ctx.onLockReference} />}
                  {t.id === "validate" && <ValidateTab errors={ctx.errors} onJump={ctx.onJump} />}
                  {t.id === "progress" && <ProgressTab stats={ctx.stats} freezeReasons={ctx.freezeReasons} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.RightPanel = RightPanel;
