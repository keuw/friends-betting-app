import { BettingApp } from "./BettingApp";
import Link from "next/link";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <main className="landing-shell">
        <nav className="landing-nav">
          <Link className="brand-lockup" href="/" aria-label="Sidebet home">
            <span className="brand-mark">S/B</span>
            <span>SIDEBET</span>
          </Link>
          <a className="text-link" href={chatGPTSignInPath("/")}>
            Sign in
          </a>
        </nav>

        <section className="landing-hero">
          <div className="landing-copy">
            <h1>
              Friendly wagers.
              <br />
              <em>Finally settled.</em>
            </h1>
            <p className="landing-lede">
              Make the call, negotiate the odds, and keep a clean record of who
              owes who—without moving a single dollar through the app.
            </p>
            <a className="primary-cta" href={chatGPTSignInPath("/")}>
              <span>Enter with ChatGPT</span>
              <span aria-hidden="true">↗</span>
            </a>
            <p className="microcopy">
              For private groups of friends. Payments happen offline.
            </p>
          </div>

          <div className="landing-demo" aria-label="Example Sidebet wager">
            <div className="demo-tape">OPEN OFFER · 1 SPOT</div>
            <div className="demo-card">
              <div className="demo-card-head">
                <span className="avatar avatar-coral">M</span>
                <div>
                  <strong>Maya is calling it</strong>
                  <span>2-leg parlay · closes Friday</span>
                </div>
                <span className="odds-stamp">+300</span>
              </div>
              <div className="demo-pick">
                <span>01</span>
                <p>Knicks win the series</p>
                <b>YES</b>
              </div>
              <div className="demo-pick">
                <span>02</span>
                <p>Alex is late to dinner</p>
                <b>YES</b>
              </div>
              <div className="demo-terms">
                <div>
                  <span>Maya risks</span>
                  <strong>$20</strong>
                </div>
                <div className="terms-arrow">→</div>
                <div>
                  <span>You risk</span>
                  <strong>$60</strong>
                </div>
              </div>
              <button type="button" className="demo-button" disabled>
                Take the other side
              </button>
            </div>
            <div className="debt-ticket">
              <span>SETTLEMENT BOARD</span>
              <strong>Alex owes Jordan $42.00</strong>
              <small>Awaiting offline payment</small>
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <span>No deposits. No wallet. No payment processing.</span>
          <span>Every accepted bet is public to the group.</span>
        </footer>
      </main>
    );
  }

  return (
    <BettingApp
      viewer={{ displayName: user.displayName }}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
