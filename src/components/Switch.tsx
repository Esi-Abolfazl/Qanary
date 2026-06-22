/** Minimal CSS toggle switch wrapping a native checkbox (keeps a11y for free). */
export function Switch({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}) {
  return (
    <label className="switch">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" />
    </label>
  );
}
