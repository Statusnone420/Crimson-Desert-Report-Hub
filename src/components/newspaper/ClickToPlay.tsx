"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { VideoStill } from "@/lib/expansion";

const subscribeNever = () => () => {};

/**
 * A local still that becomes YouTube's privacy-enhanced player only when the reader asks for it, so
 * the page loads nothing from YouTube before then. Before hydration, or without JavaScript, the
 * still is a plain link to the video.
 */
export function ClickToPlay({ videoId, url, title, still }: { videoId: string; url: string; title: string; still: VideoStill }) {
  const scripted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (playing) player.current?.focus();
  }, [playing]);
  const tall = still.height > still.width;
  const cover = (
    <>
      <Image src={still.src} width={still.width} height={still.height} alt="" sizes={tall ? "360px" : "(max-width: 750px) 100vw, 700px"} />
      <span className="click-to-play__badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>
        {scripted ? "Play" : "Watch on YouTube"}
      </span>
    </>
  );
  return (
    <div className={`click-to-play${tall ? " is-tall" : ""}`} style={{ aspectRatio: `${still.width} / ${still.height}` }}>
      {playing ? (
        <iframe
          ref={player}
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1`}
          title={`${title}, YouTube player`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : scripted ? (
        <button type="button" aria-label={`Play ${title}`} onClick={() => setPlaying(true)}>{cover}</button>
      ) : (
        <a href={url} target="_blank" rel="noreferrer noopener" aria-label={`Watch ${title} on YouTube`}>{cover}</a>
      )}
    </div>
  );
}
