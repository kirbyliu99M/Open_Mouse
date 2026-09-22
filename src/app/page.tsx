import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">In development</p>
      <h1>Open_Mouse</h1>
      <p>Finding a mouse that fits your hand.</p>
      <p className="note">
        Hand scanning and fit recommendations are coming later.
      </p>
      <p>
        <Link href="/account">Sign in to keep your scans</Link>
      </p>
    </main>
  );
}
