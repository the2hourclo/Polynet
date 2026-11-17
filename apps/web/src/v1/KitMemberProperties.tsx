// Design system v1: member properties on a member's record (the host's side).
// The host's own fields about the people in their community, one row each:
// the name on the left, the value on the right, changed where it is read and
// saved when the field is left. "Add a field" defines a new one; a field's
// name opens its settings (rename, choices, show in the table, remove).
// Rules and limits: shared/communityMemberProperties.ts.
import { useEffect, useState } from "react";
import {
  MEMBER_PROPERTY_LIMIT,
  MEMBER_PROPERTY_TABLE_LIMIT,
  MEMBER_PROPERTY_TYPES,
  MEMBER_PROPERTY_TYPE_LABELS,
  splitMemberPropertyOptions,
  type MemberPropertyType,
  type MemberPropertyValue,
} from "../../../../shared/communityMemberProperties";
import type { CloudMemberProperty } from "../../../../shared/cloudCommunityMemberRecordsGateway";
import { askInApp } from "../../../../shared/inAppConfirm";
import { Btn, cx } from "./kit";

export type MemberPropertyActions = {
  onSetValue: (key: string, value: MemberPropertyValue | null) => Promise<void>;
  onCreate: (draft: { name: string; type: MemberPropertyType; options: string[]; inTable: boolean }) => Promise<void>;
  onUpdate: (key: string, patch: { name?: string; options?: string[]; inTable?: boolean }) => Promise<void>;
  onArchive: (key: string) => Promise<void>;
};

const friendly = (error: unknown) => {
  const code = String((error as Error)?.message ?? "");
  if (code.includes("name_taken")) return "There is already a field with that name.";
  if (code.includes("table_full")) return `The table shows ${MEMBER_PROPERTY_TABLE_LIMIT} fields at most. Take one out first.`;
  if (code.includes("limit_reached")) return `A community can have ${MEMBER_PROPERTY_LIMIT} fields.`;
  if (code.includes("options")) return "Add at least one choice, each different.";
  if (code.includes("value_invalid")) return "That doesn't fit this field.";
  if (code.includes("name_invalid")) return "Give the field a name.";
  return "That couldn't be saved. Try again.";
};

export function MemberDetails(props: {
  properties: CloudMemberProperty[];
  values: Record<string, MemberPropertyValue>;
  // Absent for the host's own record: there is no membership to hold values.
  canEdit: boolean;
  actions: MemberPropertyActions;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownInTable = props.properties.filter((property) => property.in_table).length;
  const run = async (work: () => Promise<void>) => {
    setError(null);
    try { await work(); } catch (caught) { setError(friendly(caught)); throw caught; }
  };
  return (
    <div className={cx("sec")}>
      <span className={cx("lab")}>Details<em className={cx("priv")}>Only hosts see these</em></span>
      {props.properties.length === 0 && !adding ? (
        <p className={cx("sub")} style={{ margin: 0, fontSize: 13.5 }}>Keep your own fields about members here, like their business, stage or goal.</p>
      ) : null}
      <div className={cx("mdetails")}>
        {props.properties.map((property) => editing === property.key ? (
          <PropertyForm key={property.key} initial={property} tableFull={!property.in_table && shownInTable >= MEMBER_PROPERTY_TABLE_LIMIT}
            onCancel={() => setEditing(null)}
            onSave={async (draft) => {
              await run(() => props.actions.onUpdate(property.key, { name: draft.name, inTable: draft.inTable,
                ...(property.type === "select" || property.type === "multi_select" ? { options: draft.options } : {}) }));
              setEditing(null);
            }}
            onRemove={async () => {
              const yes = await askInApp({ message: `Remove "${property.name}"? Its values leave every member's record.`, yes: "Remove", no: "Cancel" });
              if (!yes) return;
              await run(() => props.actions.onArchive(property.key));
              setEditing(null);
            }} />
        ) : (
          <div key={property.key} className={cx("mdetail")}>
            <span title={property.name}>
              <button type="button" className={cx("mprop-name")} style={{ color: "inherit", font: "inherit", cursor: "pointer" }}
                aria-label={`Change the ${property.name} field`} onClick={() => setEditing(property.key)}>{property.name}</button>
            </span>
            <ValueEditor property={property} value={props.values[property.key] ?? null} disabled={!props.canEdit}
              onSave={(value) => run(() => props.actions.onSetValue(property.key, value)).catch(() => undefined)} />
          </div>
        ))}
      </div>
      {adding ? (
        <PropertyForm tableFull={shownInTable >= MEMBER_PROPERTY_TABLE_LIMIT} onCancel={() => setAdding(false)}
          onSave={async (draft) => { await run(() => props.actions.onCreate(draft)); setAdding(false); }} />
      ) : props.properties.length < MEMBER_PROPERTY_LIMIT ? (
        <button type="button" className={cx("mprop-add")} onClick={() => { setEditing(null); setAdding(true); }}>+ Add a field</button>
      ) : null}
      {error ? <p className={cx("bad")} role="alert" style={{ margin: "6px 0 0", fontSize: 13 }}>{error}</p> : null}
    </div>
  );
}

// One value, edited where it is read. Text, numbers, dates and links save when
// the field is left (or on Enter); choices and the yes/no box save at once.
function ValueEditor(props: { property: CloudMemberProperty; value: MemberPropertyValue | null; disabled: boolean; onSave: (value: MemberPropertyValue | null) => void }) {
  const { property } = props;
  const asText = props.value === null || props.value === undefined ? "" : Array.isArray(props.value) ? props.value.join(", ") : String(props.value);
  const [draft, setDraft] = useState(asText);
  useEffect(() => { setDraft(asText); }, [asText]);
  const commit = () => {
    if (draft === asText) return;
    if (property.type === "number") {
      const text = draft.replace(/,/g, "").trim();
      props.onSave(text === "" ? null : Number(text));
      return;
    }
    props.onSave(draft.trim() === "" ? null : draft);
  };
  if (property.type === "checkbox") {
    return <input type="checkbox" checked={props.value === true} disabled={props.disabled} aria-label={property.name}
      onChange={(event) => props.onSave(event.target.checked)} />;
  }
  if (property.type === "select") {
    return (
      <select value={typeof props.value === "string" ? props.value : ""} disabled={props.disabled} aria-label={property.name}
        onChange={(event) => props.onSave(event.target.value || null)}>
        <option value="">Empty</option>
        {property.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (property.type === "multi_select") {
    const picked = new Set(Array.isArray(props.value) ? props.value : []);
    return (
      <div className={cx("mchips")} role="group" aria-label={property.name}>
        {property.options.map((option) => (
          <button key={option} type="button" className={cx(picked.has(option) && "on")} aria-pressed={picked.has(option)} disabled={props.disabled}
            onClick={() => {
              const next = new Set(picked);
              if (next.has(option)) next.delete(option); else next.add(option);
              props.onSave(next.size ? [...next] : null);
            }}>{option}</button>
        ))}
      </div>
    );
  }
  return (
    <input type={property.type === "date" ? "date" : "text"} inputMode={property.type === "number" ? "decimal" : undefined}
      value={draft} disabled={props.disabled} aria-label={property.name} placeholder="Empty"
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); (event.target as HTMLInputElement).blur(); } if (event.key === "Escape") setDraft(asText); }} />
  );
}

// A field's settings: new, or an existing one (its kind can't change, so its
// values always fit it).
function PropertyForm(props: {
  initial?: CloudMemberProperty;
  tableFull: boolean;
  onSave: (draft: { name: string; type: MemberPropertyType; options: string[]; inTable: boolean }) => Promise<void>;
  onCancel: () => void;
  onRemove?: () => Promise<void>;
}) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [type, setType] = useState<MemberPropertyType>(props.initial?.type ?? "text");
  const [options, setOptions] = useState((props.initial?.options ?? []).join(", "));
  const [inTable, setInTable] = useState(props.initial?.in_table ?? !props.tableFull);
  const [busy, setBusy] = useState(false);
  const choices = type === "select" || type === "multi_select";
  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try { await props.onSave({ name, type, options: choices ? splitMemberPropertyOptions(options) : [], inTable }); } catch { /* shown above */ } finally { setBusy(false); }
  };
  return (
    <form className={cx("mprop-form")} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Field name, like Business type" aria-label="Field name" autoFocus maxLength={60} />
      {props.initial ? null : (
        <select value={type} onChange={(event) => setType(event.target.value as MemberPropertyType)} aria-label="Kind of field">
          {MEMBER_PROPERTY_TYPES.map((entry) => <option key={entry} value={entry}>{MEMBER_PROPERTY_TYPE_LABELS[entry]}</option>)}
        </select>
      )}
      {choices ? <input value={options} onChange={(event) => setOptions(event.target.value)} placeholder="Choices, separated by commas" aria-label="Choices" /> : null}
      <label title={props.tableFull && !inTable ? `The table shows ${MEMBER_PROPERTY_TABLE_LIMIT} fields at most` : undefined}>
        <input type="checkbox" checked={inTable} disabled={props.tableFull && !inTable} onChange={(event) => setInTable(event.target.checked)} />
        Show in the Members table
      </label>
      <div className={cx("acts")}>
        <Btn small go onClick={() => void save()}>{busy ? "Saving…" : props.initial ? "Save" : "Add field"}</Btn>
        <Btn small txt onClick={props.onCancel}>Cancel</Btn>
        {props.onRemove ? <button type="button" className={cx("btn sm txt no")} style={{ marginLeft: "auto" }} onClick={() => void props.onRemove?.()}>Remove field</button> : null}
      </div>
    </form>
  );
}
