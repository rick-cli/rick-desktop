export function RickLogo({ size = 32 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            role="img"
            aria-label="Rick"
            xmlns="http://www.w3.org/2000/svg"
        >
            <rect x="4" y="4" width="92" height="92" rx="18" fill="var(--primary)" />
            <text
                x="50"
                y="68"
                fill="var(--primary-foreground)"
                fontFamily="var(--font-sans)"
                fontSize="52"
                fontWeight="600"
                textAnchor="middle"
            >
                R
            </text>
        </svg>
    );
}
