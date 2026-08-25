"use client";
import { useState } from "react";

type Mood = "idle" | "working" | "happy";

export function Mascot({ mood = "idle", size = 160 }: { mood?: Mood; size?: number }) {
  const [poked, setPoked] = useState(false);
  const waveSpeed = mood === "working" ? "1.1s" : "2.2s";
  const bobSpeed = mood === "happy" ? "1.4s" : "3s";

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      onClick={() => { setPoked(true); setTimeout(() => setPoked(false), 300); }}
      className="cursor-pointer select-none"
      style={{ animation: `bob ${bobSpeed} ease-in-out infinite` }}
    >
      {[0, 0.15, 0.3, 0.45, 0.6].map((delay, i) => {
        const paths = [
          "M 70 130 Q 55 155 60 180 Q 62 190 55 195",
          "M 85 140 Q 78 165 82 188",
          "M 100 145 Q 100 170 100 192",
          "M 115 140 Q 122 165 118 188",
          "M 130 130 Q 145 155 140 180 Q 138 190 145 195",
        ];
        return (
          <path
            key={i}
            d={paths[i]}
            fill="none"
            stroke="#D85A30"
            strokeWidth={14}
            strokeLinecap="round"
            style={{
              animation: `wave ${waveSpeed} ease-in-out infinite ${delay}s`,
              transformOrigin: `${70 + i * 15}px 135px`,
              transform: poked ? "scale(1.08)" : "scale(1)",
              transition: "transform 0.2s",
            }}
          />
        );
      })}
      <ellipse cx="100" cy="95" rx="55" ry="50" fill="#F0997B" />
      <ellipse cx="78" cy="105" rx="10" ry="7" fill="#F5C4B3" opacity="0.7" />
      <ellipse cx="122" cy="105" rx="10" ry="7" fill="#F5C4B3" opacity="0.7" />
      <g style={{ animation: mood === "happy" ? "none" : "blink 4s ease-in-out infinite" }}>
        {mood === "happy" ? (
          <>
            <path d="M 72 85 Q 82 75 92 85" fill="none" stroke="#2C2C2A" strokeWidth={4} strokeLinecap="round" />
            <path d="M 108 85 Q 118 75 128 85" fill="none" stroke="#2C2C2A" strokeWidth={4} strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse cx="82" cy="85" rx="11" ry="14" fill="#2C2C2A" />
            <ellipse cx="118" cy="85" rx="11" ry="14" fill="#2C2C2A" />
            <circle cx="85" cy="80" r="3.5" fill="white" />
            <circle cx="121" cy="80" r="3.5" fill="white" />
          </>
        )}
      </g>
    </svg>
  );
}
