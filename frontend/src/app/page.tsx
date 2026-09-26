import Link from "next/link";
import { Layers, ShieldCheck, Sparkles, Wallet, SlidersHorizontal, Zap, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BentoDiagram } from "@/components/BentoDiagram";
import { Footer } from "@/components/Footer";

const STEPS = [
  {
    icon: Wallet,
    title: "Get test tokens",
    description: "Connect a wallet and mint yourself demo bWETH from the built-in faucet — no external testnet faucet needed.",
  },
  {
    icon: SlidersHorizontal,
    title: "Choose your split",
    description: "Drag the sliders or pick a preset. Weights always redistribute to sum to exactly 100%.",
  },
  {
    icon: Zap,
    title: "Approve + Split",
    description: "One approval, one transaction. Every leg of the basket settles together, or the whole thing reverts.",
  },
];

const FEATURES = [
  {
    icon: Layers,
    title: "Flash accounting",
    description:
      "All three swaps net out on one internal ledger inside a single unlock() call — real tokens move only twice: once in, once out.",
  },
  {
    icon: ShieldCheck,
    title: "All-or-nothing",
    description: "Any leg breaching its slippage floor reverts the entire transaction. No partial baskets, ever.",
  },
  {
    icon: Sparkles,
    title: "Real, live quotes",
    description: "Every quote is a real V4Quoter simulation against the seeded pools — never a hardcoded price.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-4 pt-16 pb-20 text-center sm:px-6 sm:pt-24">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
          Built on Uniswap v4 · ETHGlobal Tokyo
        </span>

        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Split one swap into a basket. Atomically.
        </h1>

        <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
          FinTessa is a Uniswap v4 periphery router that turns one input token into a fixed basket of output tokens —
          in a single, all-or-nothing transaction.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="rounded-full px-5">
            <Link href="/app">
              Launch App <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-full px-5">
            <Link href="#how-it-works">How it works</Link>
          </Button>
        </div>

        <div className="w-full pt-6">
          <BentoDiagram />
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-5xl scroll-mt-24 px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <p className="mt-2 text-sm text-muted-foreground">Three steps, one transaction.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <Card key={step.title} className="ring-border/60">
              <CardContent className="flex flex-col gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <step.icon className="size-4 text-muted-foreground" />
                </div>
                <h3 className="font-medium">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="tech" className="mx-auto w-full max-w-5xl scroll-mt-24 px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Why atomic matters</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Not a hook — a plain router that uses Uniswap v4&apos;s flash accounting to orchestrate multiple pools in
            one transaction.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="ring-border/60">
              <CardContent className="flex flex-col gap-3 pt-1">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <feature.icon className="size-4" />
                </span>
                <h3 className="font-medium">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 pb-20 sm:px-6">
        <Card className="items-center gap-4 bg-primary/5 py-10 text-center ring-primary/15">
          <CardContent className="flex flex-col items-center gap-4">
            <h2 className="text-xl font-semibold tracking-tight">Ready to try it?</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Testnet only — mint free demo bWETH and split it into a basket in under a minute.
            </p>
            <Button asChild size="lg" className="rounded-full px-5">
              <Link href="/app">
                Launch App <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <Footer />
    </div>
  );
}
