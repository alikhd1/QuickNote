// A small inline icon set.
//
// Drawn as SVG rather than using emoji: emoji are rendered by the operating system, so
// they carry their own colour, sit on their own baseline, and look different on every
// platform. These inherit currentColor and line up with the text beside them, which is
// what lets one icon read correctly in a muted sidebar row, an accent-coloured folder,
// and a red delete button without being redrawn.

interface IconProps {
  /** Edge length in pixels. Icons are square. */
  size?: number;
  className?: string;
}

function Svg({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 19V6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v2" />
      <path d="M3 19l2.2-7.3A1 1 0 0 1 6.2 11h14.3a1 1 0 0 1 .96 1.27L19.5 19z" />
    </Svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21.4 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78" />
    </Svg>
  );
}

/** A square with a pencil: compose a new note. */
export function ComposeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Svg>
  );
}

/** A split rectangle: the side-by-side preview toggle. */
export function ColumnsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </Svg>
  );
}
