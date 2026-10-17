import type { ReactNode } from "react";

/** A shared reading width and heading for the newspaper's information pages. */
export function InformationPage({ kicker, title, description, children }: {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="information-page">
      <header className="information-page__heading">
        <p className="kicker">{kicker}</p>
        <h1>{title}</h1>
        <p className="information-page__intro">{description}</p>
      </header>
      {children}
    </div>
  );
}
