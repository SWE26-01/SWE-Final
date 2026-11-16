import "./globals.css";

export const metadata = {
  title: "Agent Hub",
  description: "Discover agents made for the way you live and work.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
