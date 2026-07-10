import { Figtree } from 'next/font/google'
import { RenovateThemeProvider } from './theme'
import './selia-theme.css'

const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const themeInitScript = `(function(){var e=document.currentScript.parentElement,s=localStorage.getItem('renovate-theme'),d=s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)e.classList.add('dark');e.style.colorScheme=d?'dark':'light';})();`

export default function RenovateLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div
      className={`renovate-root ${figtree.className}`}
      id="renovate-root"
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <RenovateThemeProvider>{children}</RenovateThemeProvider>
    </div>
  )
}
