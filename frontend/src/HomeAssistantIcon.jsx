import * as mdiIcons from '@mdi/js';

const exportName = (icon) => {
  if (!icon?.startsWith('mdi:')) return null;
  const suffix = icon.slice(4).split('-').map((part) => (
    part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''
  )).join('');
  return `mdi${suffix}`;
};

export default function HomeAssistantIcon({ icon, size = 18, children }) {
  const path = mdiIcons[exportName(icon)];
  if (!path) return children;
  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
