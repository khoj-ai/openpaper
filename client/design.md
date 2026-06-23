# Client Design Guide

This document defines how the Open Paper client is built. It is **prescriptive**: where
the codebase is consistent, this codifies the pattern; where it is inconsistent, this picks
the convention and the rest should converge over time. When in doubt, follow this doc; if a
rule here is wrong, change the doc in the same PR that breaks it.

---

## 1. Philosophy & non-goals

The client is intentionally lightweight. We lean on the framework and a small set of
primitives rather than large abstraction layers.

- **No global state library.** React Context covers our cross-cutting state (auth, theme,
  analytics). Do not add Redux/Zustand/Jotai without a documented reason in this file.
- **No data-fetching library by default.** A thin `fetchFromApi` wrapper plus per-feature
  `use*` hooks is the standard. SWR/React Query is the sanctioned escape hatch (see §6), not
  the default.
- **One type source.** `src/lib/schema.ts` mirrors the backend API. Types are hand-written,
  not generated.
- **shadcn/ui + Radix for primitives.** We compose accessible primitives rather than
  building bespoke interactive widgets.

The goal is a codebase a new contributor (or agent) can predict: given a feature, you should
already know where the files go, how data is fetched, and how it's styled.

---

## 2. Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15, **App Router** |
| Language | TypeScript 5, `strict: true` |
| Styling | Tailwind CSS v4 (CSS-first, `@tailwindcss/postcss`), OKLch tokens |
| Components | shadcn/ui (New York, slate, CSS variables) over Radix UI |
| Variants | `class-variance-authority` (CVA) |
| Class merge | `cn()` = `clsx` + `tailwind-merge` |
| Icons | `lucide-react` |
| Forms | `react-hook-form` + `zod` (via `zodResolver`) |
| Toasts | `sonner` |
| Analytics | PostHog |
| PDF | `react-pdf-highlighter-extended`, `pdfjs-dist` |
| Content | `@next/mdx` + remark/rehype (gfm, math, katex) |

Path alias: `@/*` → `src/*`. shadcn aliases live in `components.json`.

---

## 3. Directory layout

```
src/
├── app/                    # App Router. Route groups by layout, not by feature:
│   ├── (main)/             #   authenticated app shell (AppSidebar)
│   ├── (paper)/            #   paper reader (own layout)
│   ├── (home)/             #   public landing
│   ├── (blog)/ (legal)/    #   MDX content / legal
│   └── api/                #   Next route handlers (kept minimal)
├── components/
│   ├── ui/                 # shadcn/ui primitives ONLY. Generated/standard, rarely hand-edited.
│   ├── magicui/            # decorative/animated components
│   ├── <feature>/          # multi-file feature areas (pdf-viewer/, zotero/)
│   └── <FeatureComponent>.tsx  # single feature components at root
├── lib/                    # cross-cutting singletons & config
│   ├── api.ts              #   fetchFromApi / fetchStreamFromApi  ← the only fetch path
│   ├── auth.tsx            #   AuthProvider + useAuth
│   ├── schema.ts           #   ALL shared types
│   ├── utils.ts            #   cn(), formatters, color hashing
│   └── providers.tsx       #   PostHog / Theme providers
└── hooks/                  # shared domain & data hooks (see §5)
```

**Where does a new file go?**

- A shadcn primitive → `components/ui/`.
- A reusable data/domain hook → `src/hooks/`.
- A hook bound to exactly one component or feature area → colocated with that component
  (e.g. `components/pdf-viewer/usePdfSearch.ts`).
- A feature component used in one route → `components/<Name>.tsx`.
- A feature with several files → `components/<feature>/`.
- A shared type → `src/lib/schema.ts`.

---

## 4. Components

**File & naming conventions** (these are rules, not suggestions):

- Component files are **PascalCase**: `PaperCard.tsx`. Primitives in `ui/` are kebab-case
  (shadcn convention): `button.tsx`.
- Props interface is named `<Component>Props`.
- **Default export** for feature components; **named exports** for primitives, hooks, and
  utilities.
- Every interactive component starts with `"use client"`. Pages and layouts stay Server
  Components unless they need client features. Wrap `useSearchParams()` usage in `<Suspense>`.

**Variants via CVA.** Anything with visual variants follows the `button.tsx` pattern: a
`cva()` definition, `data-slot` attribute for targeting, and `cn(variants({ ... className }))`
in the render. Do not branch on props with ad-hoc ternaries when CVA fits.

```tsx
const cardVariants = cva("rounded-lg border", {
  variants: { tone: { default: "bg-card", muted: "bg-muted" } },
  defaultVariants: { tone: "default" },
})

function Stat({ className, tone, ...props }: StatProps) {
  return <div data-slot="stat" className={cn(cardVariants({ tone, className }))} {...props} />
}
```

**Composition.** Prefer Radix `asChild` (Slot) and compound components (`Form` /
`FormField` / `FormControl`) over prop explosions. Prop drilling is acceptable for shallow
trees; reach for Context only for genuinely cross-cutting state.

**Size guideline.** A component over ~300 lines is a smell. Split presentational subsections
into their own components and lift derived/data logic into helpers or a hook. `components/sidebar/`
is the worked example: a `<300`-line `AppSidebar` orchestrator composes `SidebarNav` and
`SidebarFooter`, with pure logic (`getSubscriptionWarning`, `buildReferralEntry`) and config
(`navItems`) pulled into sibling modules.

---

## 5. Hooks

**Decision — one location rule.** Shared domain/data hooks live in `src/hooks/` and are named
camelCase `useThing.ts` returning the standard shape (§6). Hooks that are coupled to a single
component or feature area are colocated with it. There is no general-purpose
`components/hooks/` bucket — the PDF hooks currently there are feature-coupled and should move
under `components/pdf-viewer/` (and be renamed to `use*` camelCase) as they're touched.

The standard data hook shape:

```ts
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refetch = useCallback(async () => {
    setIsLoading(true); setError(null)
    try {
      setProjects(await fetchFromApi("/api/projects") ?? [])
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch projects"))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { refetch() }, [refetch])
  return { projects, isLoading, error, refetch }
}
```

Every data hook returns `{ <data>, isLoading, error, refetch }`. Keep the names consistent so
consumers are interchangeable.

---

## 6. Data fetching

**All network access goes through `src/lib/api.ts`.** Never call `fetch` directly in a
component. Use `fetchFromApi` for JSON, `fetchStreamFromApi` for SSE/streaming.

- Auth is cookie-based: the wrapper sets `credentials: 'include'`. Don't pass tokens manually.
- `Content-Type: application/json` is set automatically unless the body is `FormData`.
- **API error contract:** the backend returns an error under one of `message`, `error`, or
  `detail`. The wrapper normalizes these into a thrown `Error`. Server code should keep using
  these keys.
- A `204` resolves to `null` — handle the empty case.

**Mutations & optimistic updates.** Mutate via `fetchFromApi(..., { method })`, then either
`refetch()` or apply an optimistic patch and reconcile:

```ts
const updatePaper = useCallback((id: string, patch: Partial<PaperItem>) =>
  setPapers(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p)), [])
```

**Decision — caching.** The default is refetch-on-mount; we accept the resulting duplicate
requests as a fair trade for simplicity. **When the same resource is fetched by 3+ unrelated
places, or refetch waterfalls become user-visible, lift it** — first into a Context provider
(the auth/theme pattern), and only if that's insufficient adopt SWR scoped to that resource.
Document any SWR introduction here. Do not pre-emptively cache.

---

## 7. Types

- **All shared types live in `src/lib/schema.ts`** and mirror the backend response shapes.
  Don't redeclare API shapes locally.
- **Decision — no TS `enum`s.** Use `as const` objects with a derived union type instead
  (avoids the runtime/`erasableSyntaxOnly` footguns and gives string-literal ergonomics).
  The value object and the type share **one name** — no parallel `*Type` union aliases:

  ```ts
  export const JobStatus = {
    PENDING: "pending", RUNNING: "running", COMPLETED: "completed",
    FAILED: "failed", CANCELLED: "cancelled",
  } as const
  export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus]
  ```

  `JobStatus`, `SubscriptionStatus`, and `ProjectRole` all follow this. Note one consequence:
  because members are now plain string literals (not nominal enum members), a `switch` over
  the union is genuinely exhaustive — a `default` branch narrows the discriminant to `never`,
  so cast (`status as string`) if you keep one as a runtime safety net.
- Use string-literal unions for small closed sets that have no runtime use
  (`HighlightType`, `HighlightColor`).

---

## 8. Styling & theming

- **Compose classes with `cn()`.** Never concatenate class strings by hand.
- **Color comes from tokens, never hardcoded hex.** All theme color lives as OKLch CSS
  variables in `src/app/globals.css` (`--primary`, `--background`, `--sidebar`, `--chart-*`,
  …). Use the Tailwind token classes (`bg-primary`, `text-muted-foreground`) so dark mode and
  theming work for free.
- **Dark mode** is the `.dark` class on `<html>`, persisted in `localStorage.darkMode`,
  applied by a pre-hydration script to avoid flash. Toggle via `useDarkMode`.
- **Radius** scales from the `--radius` token.
- Deterministic, content-derived colors (avatars, tags) go through the helpers in
  `lib/utils.ts` (`getAlphaHashToBackgroundColor`, `getInitials`) — don't reinvent them.

---

## 9. Branding

The visual identity is **blue-forward, with a neutral slate base**. Color carries meaning;
use it intentionally.

- **Brand color: Tailwind `blue-500`** (with `blue-600` for hover/active and `blue-400` in
  dark mode). It is by far the most-used accent in the app and signals "Open Paper" /
  primary-interactive / on-brand emphasis. Reach for the blue scale for branded affordances,
  links, focus accents, and hero/marketing emphasis.
  - Light surfaces: `bg-blue-50` / `bg-blue-100`, text `text-blue-600` / `text-blue-700`.
  - Dark surfaces: `bg-blue-900` / `bg-blue-950`, text `text-blue-400` / `text-blue-300`.
  - Gradients use the blue scale (`from-blue-500 to-blue-500`, etc.).
- **Neutral base is slate** (the shadcn base color), expressed through the OKLch theme tokens
  in §8 (`background`, `foreground`, `muted`, `border`). Chrome, surfaces, and body text use
  tokens — **not** raw blue. Blue is an accent on top of a neutral base, not the background.
- **Typography: Geist** (`Geist` sans, `Geist_Mono` for code/mono), loaded via
  `next/font/google` and exposed as `--font-geist-sans` / `--font-geist-mono`. Don't
  introduce new font families.
- **Logo / mark:** `public/openpaper.svg` (wordmark), `public/icon.svg` / `src/app/icon.svg`
  (favicon/app icon), with variants under `public/logos/`. Use these assets; don't recreate
  the mark inline.

**Semantic colors** are reserved and should not be used decoratively:

| Meaning | Scale | Typical use |
| --- | --- | --- |
| Brand / primary | `blue` | links, branded emphasis, primary accents |
| Destructive / error | `red` (and the `--destructive` token) | delete actions, error toasts |
| Success | `green` | success states, positive confirmation |
| Warning | `yellow` | cautions, soft warnings |

**Conventions:**

- Prefer the **theme token** (`bg-primary`, `text-muted-foreground`) for anything that is part
  of the neutral UI; prefer the **blue scale** for branded accents. Avoid hardcoding hex —
  always go through Tailwind scale classes or tokens so dark mode tracks correctly.
- Always provide a dark-mode counterpart for a brand/semantic color (`text-blue-600
  dark:text-blue-400`). A light-only blue is a bug.
- The PDF **highlight palette** (`yellow` / `green` / `blue` / `pink` / `purple`, see
  `HighlightColor` in `schema.ts`) is a separate, domain-specific palette for annotations —
  it is not the brand palette and the two should not be conflated.

---

## 10. Routing & auth

- **Route groups organize by layout**, not feature: `(main)` = authenticated shell,
  `(paper)` = reader, `(home)`/`(blog)`/`(legal)` = public. Put a route where its chrome
  belongs.
- **Auth state** comes from `useAuth()` (`AuthProvider` in `lib/auth.tsx`): Google OAuth →
  `auth_url` redirect → cookie set by backend → `/auth/callback`. Session is verified against
  `/api/auth/me`.

**Gating — `RequireAuth` at a nested `(protected)` group.** Auth is enforced once at the
layout level, not re-implemented per page. The wrapper lives at
`components/auth/RequireAuth.tsx`: while auth resolves it shows a spinner; if unauthenticated
it `router.replace`s to `/login?returnTo=<path>`; otherwise it renders its children.

```tsx
// components/auth/RequireAuth.tsx
"use client"
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`)
  }, [loading, user, pathname, router])
  if (loading) return <Spinner />
  return user ? <>{children}</> : null
}
```

It is **not** applied to a whole route-group layout, because both `(main)` and `(paper)`
mix public and protected routes (`/login`, `/pricing`, `/paper/share/[id]` must stay open).
Instead, protected routes live in a nested **`(protected)` route group** whose layout renders
`<RequireAuth>`. Route groups don't affect URLs, so `/papers` stays `/papers`:

```
app/(main)/
├── layout.tsx              # shell: sidebar, providers, AuthProvider
├── (protected)/layout.tsx  # <RequireAuth> — gates everything below
│   └── page.tsx, papers/, projects/, settings/, discover/, finder/, graph/, …
├── login/  pricing/  about/  auth/        # public, outside the group

app/(paper)/paper/
├── layout.tsx
├── (protected)/layout.tsx  # <RequireAuth>
│   └── [id]/               # owner view, gated
└── share/[id]/             # public shared view, outside the group
```

**To add a page:** drop it under `(protected)/` if it needs a user, or at the group root if
it's public. Don't add `useAuth()`-redirect logic to the page itself.

We intentionally do **not** use Next middleware for auth: the authoritative check is a
backend cookie-session verify, which the client-side provider already performs. Revisit only
if we need to gate before first paint.

---

## 11. UX conventions

- **Feedback is a toast.** Use `sonner`: `toast.success(...)` / `toast.error(...)` on the
  result of every user-initiated mutation. Log technical detail with `console.error`; show the
  user a friendly message.
- **Loading** is the hook's `isLoading` boolean → skeleton or spinner. Don't render
  half-populated data.
- **Forms** are `react-hook-form` + a `zod` schema via `zodResolver`, using the `Form` /
  `FormField` / `FormControl` / `FormMessage` compound components. Submit handlers are async
  and surface errors via `FormMessage` (field) and a toast (request).
- **Destructive actions** go through an `AlertDialog` confirmation, never a bare button.
- **Accessibility** comes from Radix primitives — prefer them over hand-rolled menus/dialogs;
  keep `aria-*` wiring the primitives provide.

---

## 12. Open conventions to converge

List new divergences here as they appear, and move toward them opportunistically (when you touch the relevant file), not in a big-bang refactor.
