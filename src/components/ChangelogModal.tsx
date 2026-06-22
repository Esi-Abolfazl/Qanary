import { Fragment, type ReactNode } from "react";

/**
 * Render the small Markdown subset our CHANGELOG uses: `###` headings, `-`/`*` lists,
 * `>` blockquotes, paragraphs, with inline `**bold**` and `` `code` ``.
 * Deliberately tiny — input is our own release notes, not arbitrary Markdown.
 */
// ponytail: subset renderer, not CommonMark. Swap for react-markdown only if notes
//           ever need tables/links/nested lists.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    out.push(
      m[1] ? <strong key={k++}>{m[1]}</strong> : <code key={k++}>{m[2]}</code>,
    );
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
    if (/^#{1,6}\s/.test(line)) {
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

/** Shows the release notes for a just-installed update, once per version. */
export function ChangelogModal({
  version,
  body,
  onClose,
}: {
  version: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-changelog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Qanary v{version}</h3>
        <div className="changelog-body">
          {body.trim() ? renderMarkdown(body) : <p className="cl-p">No release notes provided.</p>}
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
