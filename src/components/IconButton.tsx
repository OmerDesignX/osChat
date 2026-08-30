import { FeatherIcon } from "./FeatherIcon";
export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  badge,
  className = "",
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  badge?: number | string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <FeatherIcon icon={icon as never} size="17" />
      <span>{label}</span>
      {badge !== undefined && badge !== 0 && badge !== "" && (
        <i className="icon-button-badge" aria-label={`${badge} unread`}>
          {badge}
        </i>
      )}
    </button>
  );
}
