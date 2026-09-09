// Small decorative bumper-sticker flourishes for the landing/lobby screen —
// hand-drawn inline SVG rather than generated images, so they stay crisp at
// any size and cost nothing to ship. They echo the die-cut vinyl stickers
// scattered across the physical VNTYPL8S box art (an alien in a UFO, a
// Route 66 shield, a paw print) without copying it. Purely decorative:
// aria-hidden and pointer-events: none so they never interfere with layout
// or touch targets.

export function AlienSticker({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`sticker ${className}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="30" fill="#fff" />
      <circle cx="32" cy="32" r="26" fill="#182848" />
      <ellipse cx="32" cy="42" rx="16" ry="6" fill="#7c5cff" stroke="#2c1e63" strokeWidth="2" />
      <rect x="18" y="36" width="28" height="4" rx="2" fill="#b7a6ff" />
      <ellipse cx="32" cy="28" rx="12" ry="14" fill="#7ee081" stroke="#1f6b41" strokeWidth="2" />
      <ellipse cx="27" cy="27" rx="3.4" ry="4.6" fill="#0d1420" />
      <ellipse cx="37" cy="27" rx="3.4" ry="4.6" fill="#0d1420" />
      <path d="M24 35c3 2 13 2 16 0" stroke="#1f6b41" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M20 40l-8-3M44 40l8-3" stroke="#2c1e63" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Route66Sticker({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`sticker ${className}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="30" fill="#fff" />
      <path
        d="M32 6l22 8v14c0 14-9 22-22 30C19 50 10 42 10 28V14z"
        fill="#fff"
        stroke="#16202e"
        strokeWidth="2"
      />
      <path
        d="M32 10l18 6.4V28c0 11.6-7.3 18.4-18 24.8C21.3 46.4 14 39.6 14 28V16.4z"
        fill="#1f3a8f"
      />
      <rect x="17" y="24" width="30" height="16" rx="2" fill="#fff" />
      <text
        x="32"
        y="35"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="800"
        fontSize="11"
        fill="#c0322d"
      >
        66
      </text>
      <text
        x="32"
        y="20"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
        fontSize="6"
        fill="#fff"
        letterSpacing="1"
      >
        ROUTE
      </text>
    </svg>
  );
}

/** Tiny paperclip flourish for the Owner-card "reveal" moment — a nod to the
 * physical game's DMV Plate Application Form cards. */
export function Paperclip({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`paperclip ${className}`}
      viewBox="0 0 26 34"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 10V6a5 5 0 0 1 10 0v18a3 3 0 0 1-6 0V9a1.4 1.4 0 0 1 2.8 0v14"
        fill="none"
        stroke="#c7cedb"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PawSticker({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`sticker ${className}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="30" fill="#fff" />
      <circle cx="32" cy="32" r="26" fill="#123a4a" />
      <ellipse cx="32" cy="38" rx="13" ry="11" fill="#4fc9d6" />
      <ellipse cx="18" cy="24" rx="5.4" ry="6.6" fill="#4fc9d6" />
      <ellipse cx="30" cy="17" rx="5.4" ry="6.8" fill="#4fc9d6" />
      <ellipse cx="42" cy="19" rx="5.2" ry="6.6" fill="#4fc9d6" />
      <ellipse cx="49" cy="29" rx="4.8" ry="6" fill="#4fc9d6" />
    </svg>
  );
}
