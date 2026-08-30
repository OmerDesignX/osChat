import feather from "feather-icons";
import type { MouseEventHandler } from "react";

export function FeatherIcon({
  icon,
  size = 24,
  onClick,
}: {
  icon: string;
  size?: number | string;
  onClick?: MouseEventHandler<SVGSVGElement>;
}) {
  const definition = feather.icons[icon as keyof typeof feather.icons];
  if (!definition) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      data-icon={icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      pointerEvents={onClick ? "auto" : "none"}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: definition.contents }}
    />
  );
}
