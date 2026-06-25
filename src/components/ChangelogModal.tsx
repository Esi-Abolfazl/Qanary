import { Fragment, useState, type ReactNode } from "react";
import type { ChangelogEntry } from "../api";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "./Icon";

/**
 * Render the small Markdown subset our CHANGELOG uses: `###` headings, `-`/`*` lists,
 * `>` blockquotes, `---` rules, paragraphs, with inline `**bold**`, `` `code` ``,
 * and `[text](url)` links (opened in the system browser).
 * Deliberately tiny — input is our own release notes, not arbitrary Markdown.
 */
// ponytail: subset renderer, not CommonMark. Swap for react-markdown only if notes
//           ever need tables/images/nested lists.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1]) {
      out.push(<strong key={k++}>{m[1]}</strong>);
    } else if (m[2]) {
      out.push(<code key={k++}>{m[2]}</code>);
    } else {
      const href = m[4];
      out.push(
        <a
          key={k++}
          href={href}
          className="cl-link"
          onClick={(e) => {
            e.preventDefault();
            void openUrl(href);
          }}
        >
          {m[3]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return out;
}

function renderMarkdown(body: string): ReactNode[] {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="cl-hr" />);
      i++;
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(
        <h4 key={key++} className="cl-h">
          {inline(line.replace(/^#{1,6}\s/, ""))}
        </h4>,
      );
      i++;
    } else if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="cl-quote">
          {inline(quote.join(" "))}
        </blockquote>,
      );
    } else if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="cl-ul">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>,
      );
    } else {
      blocks.push(
        <p key={key++} className="cl-p">
          {inline(line)}
        </p>,
      );
      i++;
    }
  }
  return blocks;
}

function VersionCard({
  entry,
  open,
  onToggle,
}: {
  entry: ChangelogEntry;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="cl-version">
      <button className={`cl-version-head${open ? " cl-version-head--open" : ""}`} onClick={onToggle}>
        <span className="cl-version-name">v{entry.version}</span>
        <span className="cl-version-head-right">
          {entry.isPrevious && <span className="cl-version-prev">Your previous version</span>}
          <Icon name={open ? "chevronUp" : "chevronDown"} size={16} />
        </span>
      </button>
      {open && (
        <div className="cl-version-body">
          {entry.body.trim()
            ? renderMarkdown(entry.body)
            : <p className="cl-p">No release notes provided.</p>}
        </div>
      )}
    </div>
  );
}

/** Shows release notes for one or more versions. Newest entry is open; older ones collapsed. */
export function ChangelogModal({
  entries,
  onClose,
}: {
  entries: ChangelogEntry[];
  onClose: () => void;
}) {
  // Single-open accordion: newest entry open by default; opening one closes the rest.
  const [openVersion, setOpenVersion] = useState<string | null>(entries[0]?.version ?? null);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-changelog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">What's new</h3>
        <div className="changelog-body">
          {entries.map((entry) => (
            <VersionCard
              key={entry.version}
              entry={entry}
              open={openVersion === entry.version}
              onToggle={() => setOpenVersion((v) => (v === entry.version ? null : entry.version))}
            />
          ))}
        </div>
        <div className="modal-actions">
          <button className="modal-save" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
