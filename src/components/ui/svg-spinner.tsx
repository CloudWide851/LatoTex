export function SvgSpinner(props: { className?: string }) {
  const { className } = props;
  return (
    <svg
      viewBox="0 0 40 40"
      className={className ?? "h-4 w-4"}
      role="img"
      aria-hidden
    >
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M20 4a16 16 0 0 1 16 16" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <animateTransform
          attributeName="transform"
          attributeType="XML"
          type="rotate"
          from="0 20 20"
          to="360 20 20"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
