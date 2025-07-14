"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
    CheckCircle,
    Clock,
    Search,
    Brain,
    Users,
    Volume2,
    FileText,
    Shield,
    GitBranch,
    Highlighter,
    MessageSquareText,
    Mic2,
    Upload,
    Play,
    HandCoins,
    GithubIcon,
    Menu,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsDarkMode } from "@/hooks/useDarkMode";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export default function OpenPaperLanding() {
    const isMobile = useIsMobile();
    const { darkMode } = useIsDarkMode();
    const mobileAndDark = isMobile && darkMode;

    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <div className="flex flex-col min-h-screen">
            {/* Header */}
            <header className="px-4 lg:px-6 h-16 flex items-center justify-between border-b border-border/40 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
                <Link href="/" className="flex items-center justify-center">
                    <Image
                        src="/openpaper.svg"
                        width={32}
                        height={32}
                        alt="Open Paper Logo"
                        className="mr-2"
                    />
                    <span className="text-xl font-bold text-primary">Open Paper</span>
                </Link>

                {/* Desktop Navigation */}
                <nav className="hidden md:flex gap-4 sm:gap-6 items-center">
                    <Link href="#features" className="text-sm font-medium hover:text-primary transition-colors text-muted-foreground">
                        Features
                    </Link>
                    <Link
                        href="#open-source"
                        className="text-sm font-medium hover:text-primary transition-colors text-muted-foreground"
                    >
                        Open Source
                    </Link>
                    <Link href="#about" className="text-sm font-medium hover:text-primary transition-colors text-muted-foreground">
                        About
                    </Link>
                    <Link href="/pricing" className="text-sm font-medium hover:text-primary transition-colors text-muted-foreground">
                        Pricing
                    </Link>
                    <Link href="/blog" className="text-sm font-medium hover:text-primary transition-colors text-muted-foreground">
                        Blog
                    </Link>
                    <Button
                        variant="outline"
                        size="sm"
                        asChild
                    >
                        <Link href="/login">Sign In</Link>
                    </Button>
                </nav>

                {/* Mobile Navigation */}
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="sm" className="md:hidden">
                            <Menu className="h-5 w-5" />
                            <span className="sr-only">Toggle menu</span>
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="p-4">
                        <nav className="flex flex-col gap-6 mt-6">
                            <Link
                                href="#features"
                                className="text-lg font-medium hover:text-primary transition-colors text-muted-foreground"
                                onClick={() => setMobileMenuOpen(false)}
                            >
                                Features
                            </Link>
                            <Link
                                href="#open-source"
                                className="text-lg font-medium hover:text-primary transition-colors text-muted-foreground"
                                onClick={() => setMobileMenuOpen(false)}
                            >
                                Open Source
                            </Link>
                            <Link
                                href="#about"
                                className="text-lg font-medium hover:text-primary transition-colors text-muted-foreground"
                                onClick={() => setMobileMenuOpen(false)}
                            >
                                About
                            </Link>
                            <Button
                                variant="outline"
                                size="lg"
                                asChild
                                className="mt-4"
                            >
                                <Link href="/login" onClick={() => setMobileMenuOpen(false)}>Sign In</Link>
                            </Button>
                        </nav>
                    </SheetContent>
                </Sheet>
            </header>

            <main className="flex-1">
                {/* Hero Section */}
                <section className="w-full py-12 md:py-24 lg:py-32 relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-muted/5"></div>
                    <div className="container px-4 md:px-6 relative max-w-6xl mx-auto">
                        <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_600px]">
                            <div className="flex flex-col justify-center space-y-4">
                                <div className="space-y-2">
                                    <Badge variant="secondary" className="w-fit bg-accent/20 text-primary border-primary/30">
                                        <Shield className="w-3 h-3 mr-1" />
                                        Research-Grade AI
                                    </Badge>
                                    <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none">
                                        Read Research Papers,{" "}
                                        <span className="text-primary">
                                            Supercharged with AI
                                        </span>
                                    </h1>
                                    <p className="max-w-[600px] text-muted-foreground md:text-xl">
                                        Read, annotate, and understand papers. Use an AI assistant with contextual citations for responses you can trust.
                                    </p>
                                </div>
                                <div className="flex flex-col gap-2 min-[400px]:flex-row">
                                    <Button size="lg" className="bg-blue-500 hover:bg-blue-600 w-full min-[400px]:w-auto" asChild>
                                        <Link href="/login">
                                            <Upload className="w-4 h-4 mr-2" />
                                            Start Free Trial
                                        </Link>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="lg"
                                        className="w-full min-[400px]:w-auto"
                                        asChild
                                    >
                                        <Link href="#demo">
                                            <Volume2 className="w-4 h-4 mr-2" />
                                            Watch Demo
                                        </Link>
                                    </Button>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                        <CheckCircle className="w-4 h-4 text-primary" />
                                        No credit card needed
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <CheckCircle className="w-4 h-4 text-primary" />
                                        Full citation tracking
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <GitBranch className="w-4 h-4 text-primary" />
                                        Open source
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-center">
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-muted/20 rounded-lg blur-2xl"></div>

                                    {/* Animated border effect */}
                                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-blue-100 to-blue-500 rounded-lg blur-sm animate-pulse"></div>
                                    <div className="relative bg-card rounded-lg border border-border p-6">
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-primary">
                                                <FileText className="w-5 h-5" />
                                                <span className="text-sm font-mono">Processing: &ldquo;Attention Is All You Need&rdquo;</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="text-xs text-muted-foreground">
                                                    <p>✓ Paper analyzed</p>
                                                    <p>✓ 47 citations verified</p>
                                                    <p>✓ Audio summary ready</p>
                                                    <p>✓ Annotations created</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>


                {/* Social Proof - Institution Logos */}
                <section id="about" className="w-full py-12 md:py-24 lg:py-32 bg-muted/50">
                    <div className="container px-4 md:px-6 max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">
                                Trusted by <span className="text-primary">Researchers</span>
                            </h2>
                            <p className="mt-4 text-muted-foreground md:text-lg max-w-3xl mx-auto">
                                Used by PhD students, academics, and industry researchers.
                            </p>
                        </div>

                        {/* Institution Logos Grid */}
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-10 gap-8 items-center justify-items-center opacity-60 dark:opacity-90 hover:opacity-100 transition-opacity duration-300">
                            {/* Stanford */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/stanford_logo.svg"
                                    alt="Stanford University"
                                    width={60}
                                    height={40}
                                    className="object-contain"
                                />
                            </div>

                            {/* Yale */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/yale_logo.svg"
                                    alt="Yale University"
                                    width={60}
                                    height={40}
                                    className="object-contain"
                                />
                            </div>

                            {/* Google */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/google.svg"
                                    alt="Google"
                                    width={60}
                                    height={40}
                                    className="object-contain"
                                />
                            </div>

                            {/* Rice University */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/rice_logo.svg"
                                    alt="Rice University"
                                    width={60}
                                    height={40}
                                    className="object-contain"
                                />
                            </div>

                            {/* University of Michigan */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/umich_logo.svg"
                                    alt="University of Michigan"
                                    width={60}
                                    height={40}
                                    className="object-contain"
                                />
                            </div>

                            {/* UIUC */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/uiuc_logo.svg"
                                    alt="University of Illinois Urbana-Champaign"
                                    width={60}
                                    height={40}
                                    className="object-contain"
                                />
                            </div>

                            {/* MIT */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/mit_logo.svg"
                                    alt="Massachusetts Institute of Technology"
                                    width={60}
                                    height={40}
                                    className="object-contain"
                                />
                            </div>

                            {/* Johns Hopkins */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/jhu_logo.svg"
                                    alt="Johns Hopkins University"
                                    width={60}
                                    height={40}
                                    className="object-contain"
                                />
                            </div>

                            {/* Waterloo */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/waterloo_logo.svg"
                                    alt="University of Waterloo"
                                    width={40}
                                    height={36}
                                    className="object-contain"
                                />
                            </div>

                            {/* NIH */}
                            <div className={`flex items-center justify-center h-12 w-20 rounded-md ${mobileAndDark ? "dark:brightness-100 dark:bg-white/80" : "grayscale dark:grayscale dark:brightness-150"} ${!mobileAndDark ? "hover:grayscale-0 hover:brightness-100 hover:bg-white/80" : ""} dark:hover:grayscale-0 dark:hover:brightness-100 dark:hover:bg-white/90 transition-all duration-300`}>
                                <Image
                                    src="/logos/nih_logo.svg"
                                    alt="National Institutes of Health"
                                    width={40}
                                    height={36}
                                    className="object-contain"
                                />
                            </div>
                        </div>

                        <div className="mt-12 text-center">
                            <p className="text-sm text-muted-foreground italic">
                                Join hundreds of researchers accelerating their work with Open Paper
                            </p>
                        </div>
                    </div>
                </section>


                {/* Video Demo Section */}
                <section id="demo" className="w-full py-12 md:py-24 lg:py-32">
                    <div className="container px-4 md:px-6 max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl mb-4">
                                See Open Paper in Action
                            </h2>
                            <p className="text-muted-foreground md:text-lg max-w-2xl mx-auto">
                                Watch how Open Paper transforms your research workflow with AI-powered insights and annotations.
                            </p>
                        </div>
                        <div className="w-full max-w-4xl mx-auto">
                            <div className="aspect-video relative rounded-lg overflow-hidden shadow-lg">
                                <iframe
                                    className="absolute top-0 left-0 w-full h-full"
                                    src="https://www.youtube.com/embed/33l8fFKgXMw?si=lbrMSmVS7gpdDicd"
                                    title="Accelerate your research with Open Paper"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                    referrerPolicy="strict-origin-when-cross-origin"
                                    allowFullScreen
                                ></iframe>
                            </div>
                        </div>
                    </div>
                </section>


                {/* Pain Points Section */}
                <section className="w-full py-12 md:py-24 lg:py-32 bg-muted/50">
                    <div className="container px-4 md:px-6 max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">
                                Common Research <span className="text-primary">Challenges</span>
                            </h2>
                            <p className="mt-4 text-muted-foreground md:text-lg max-w-2xl mx-auto">
                                We built Open Paper to solve the practical problems researchers face every day.
                            </p>
                        </div>
                        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            <Card className="group relative overflow-hidden transition-all duration-300 hover:border-blue-500/30">
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                    <div className="absolute inset-0 from-blue-500/10 via-transparent to-transparent"></div>
                                </div>
                                <CardHeader className="relative z-10">
                                    <Clock className="w-8 h-8 text-blue-500 mb-2" />
                                    <CardTitle>Time Constraints</CardTitle>
                                </CardHeader>
                                <CardContent className="relative z-10">
                                    <p className="text-muted-foreground">
                                        Reading 100+ papers takes weeks. Deadlines don&rsquo;t wait. You need efficient ways to process literature
                                        without missing key insights.
                                    </p>
                                </CardContent>
                            </Card>
                            <Card className="group relative overflow-hidden transition-all duration-300 hover:border-blue-500/30">
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                    <div className="absolute inset-0 from-blue-500/10 via-transparent to-transparent"></div>
                                </div>
                                <CardHeader className="relative z-10">
                                    <Search className="w-8 h-8 text-blue-500 mb-2" />
                                    <CardTitle>Information Overload</CardTitle>
                                </CardHeader>
                                <CardContent className="relative z-10">
                                    <p className="text-muted-foreground">
                                        Thousands of papers published daily. Hard to separate relevant studies from noise. Manual screening
                                        is exhausting and error-prone.
                                    </p>
                                </CardContent>
                            </Card>
                            <Card className="group relative overflow-hidden transition-all duration-300 hover:border-blue-500/30">
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                    <div className="absolute inset-0 from-blue-500/10 via-transparent to-transparent"></div>
                                </div>
                                <CardHeader className="relative z-10">
                                    <Brain className="w-8 h-8 text-blue-500 mb-2" />
                                    <CardTitle>Citation Management</CardTitle>
                                </CardHeader>
                                <CardContent className="relative z-10">
                                    <p className="text-muted-foreground">
                                        Keeping track of sources, page numbers, and exact quotes. Academic integrity requires precise
                                        attribution that&rsquo;s easy to lose track of.
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </section>


                {/* Feature Screenshots Section */}
                <section id="features" className="w-full py-12 md:py-24 lg:py-32">
                    <div className="container px-4 md:px-6 max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">
                                Powerful Features in <span className="text-primary">Action</span>
                            </h2>
                            <p className="mt-4 text-muted-foreground md:text-lg max-w-2xl mx-auto">
                                See how Open Paper transforms your research workflow with these key capabilities.
                            </p>
                        </div>

                        <div className="grid gap-12 lg:gap-16">
                            {/* Deep Reading */}
                            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 items-center">
                                <div className="space-y-4">
                                    <Badge variant="outline" className="w-fit border-blue-500/30 text-blue-500">
                                        <FileText className="w-3 h-3 mr-1" />
                                        Deep Reading
                                    </Badge>
                                    <h3 className="text-2xl font-bold">Read Papers Side-by-Side with AI</h3>
                                    <p className="text-muted-foreground">
                                        Never lose context while reading. Our split-pane interface keeps your paper and AI chat
                                        visible simultaneously, making it easy to ask questions and get instant, cited responses.
                                    </p>
                                    <ul className="space-y-2 text-sm">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-blue-500" />
                                            <span>Seamless paper-chat integration</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-blue-500" />
                                            <span>Context-aware AI responses</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-blue-500" />
                                            <span>Maintain reading flow</span>
                                        </li>
                                    </ul>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-lg blur-xl"></div>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="https://assets.khoj.dev/openpaper/read_paper_deeply.png"
                                        alt="Deep paper reading with AI assistance"
                                        className="relative rounded-lg shadow-lg border border-border w-full h-auto"
                                    />
                                </div>
                            </div>

                            {/* Grounded Citations */}
                            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 items-center">
                                <div className="space-y-4">
                                    <Badge variant="outline" className="w-fit border-green-500/30 text-green-500">
                                        <MessageSquareText className="w-3 h-3 mr-1" />
                                        Grounded Responses
                                    </Badge>
                                    <h3 className="text-2xl font-bold">Trust Every AI Response</h3>
                                    <p className="text-muted-foreground">
                                        Every AI answer includes precise citations that link back to specific sections in your paper.
                                        Click any citation to jump directly to the source material for verification.
                                    </p>
                                    <ul className="space-y-2 text-sm">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                            <span>Clickable citations to source</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                            <span>Page-specific references</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                            <span>Academic integrity built-in</span>
                                        </li>
                                    </ul>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 to-blue-500/10 rounded-lg blur-xl"></div>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="https://assets.khoj.dev/openpaper/grounded_citations.png"
                                        alt="AI responses with grounded citations"
                                        className="relative rounded-lg shadow-lg border border-border w-full h-auto"
                                    />
                                </div>
                            </div>

                            {/* Inline Annotations */}
                            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 items-center">
                                <div className="space-y-4">
                                    <Badge variant="outline" className="w-fit border-purple-500/30 text-purple-500">
                                        <Highlighter className="w-3 h-3 mr-1" />
                                        Smart Annotations
                                    </Badge>
                                    <h3 className="text-2xl font-bold">Highlight and Annotate Seamlessly</h3>
                                    <p className="text-muted-foreground">
                                        Select text to instantly highlight and add notes. Your annotations sync across devices
                                        and integrate with the AI chat for contextual discussions about your highlights.
                                    </p>
                                    <ul className="space-y-2 text-sm">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-purple-500" />
                                            <span>One-click highlighting</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-purple-500" />
                                            <span>Rich annotation tools</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-purple-500" />
                                            <span>Cross-device synchronization</span>
                                        </li>
                                    </ul>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg blur-xl"></div>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="https://assets.khoj.dev/openpaper/inline_annotations.png"
                                        alt="Inline annotations and highlighting"
                                        className="relative rounded-lg shadow-lg border border-border w-full h-auto"
                                    />
                                </div>
                            </div>

                            {/* Paper to Podcast */}
                            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 items-center">
                                <div className="space-y-4">
                                    <Badge variant="outline" className="w-fit border-orange-500/30 text-orange-500">
                                        <Mic2 className="w-3 h-3 mr-1" />
                                        Audio Summaries
                                    </Badge>
                                    <h3 className="text-2xl font-bold">Listen to Research On-the-Go</h3>
                                    <p className="text-muted-foreground">
                                        Transform dense academic papers into engaging audio summaries. Perfect for commutes,
                                        workouts, or when you need to absorb information hands-free.
                                    </p>
                                    <ul className="space-y-2 text-sm">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-orange-500" />
                                            <span>Natural voice synthesis</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-orange-500" />
                                            <span>Key insights highlighted</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-orange-500" />
                                            <span>Mobile-friendly playback</span>
                                        </li>
                                    </ul>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-orange-500/10 to-red-500/10 rounded-lg blur-xl"></div>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="https://assets.khoj.dev/openpaper/paper_to_podcast.png"
                                        alt="Convert papers to audio podcasts"
                                        className="relative rounded-lg shadow-lg border border-border w-full h-auto"
                                    />
                                </div>
                            </div>

                            {/* Find Related Papers */}
                            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 items-center">
                                <div className="space-y-4">
                                    <Badge variant="outline" className="w-fit border-indigo-500/30 text-indigo-500">
                                        <Search className="w-3 h-3 mr-1" />
                                        Discovery
                                    </Badge>
                                    <h3 className="text-2xl font-bold">Discover Connected Research</h3>
                                    <p className="text-muted-foreground">
                                        Find papers that build on your current research. Our semantic search understands context
                                        and relationships between studies, helping you discover relevant work you might have missed.
                                    </p>
                                    <ul className="space-y-2 text-sm">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-indigo-500" />
                                            <span>Semantic similarity search</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-indigo-500" />
                                            <span>Open access focus</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-indigo-500" />
                                            <span>Expand your literature review</span>
                                        </li>
                                    </ul>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-blue-500/10 rounded-lg blur-xl"></div>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="https://assets.khoj.dev/openpaper/find_related_papers.png"
                                        alt="Find related research papers"
                                        className="relative rounded-lg shadow-lg border border-border w-full h-auto"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Open Source Section */}
                <section id="open-source" className="w-full py-12 md:py-24 lg:py-32 bg-muted/50">
                    <div className="container px-4 md:px-6 max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl">
                                Built in the <span className="text-primary">Open</span>
                            </h2>
                            <p className="mt-4 text-muted-foreground md:text-lg max-w-2xl mx-auto">
                                Reliable research deserves transparent tools. Our entire platform is open-source, peer-reviewable, and
                                community-driven.
                            </p>
                        </div>
                        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            <Card>
                                <CardHeader>
                                    <GitBranch className="w-8 h-8 text-blue-500 mb-2" />
                                    <CardTitle>Fully Open Source</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-muted-foreground mb-4">
                                        All code is available on GitHub. Inspect, modify, and contribute to the
                                        codebase that powers your research.
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        asChild
                                    >
                                        <a href="https://github.com/khoj-ai/openpaper" target="_blank" rel="noopener noreferrer">
                                            <GithubIcon className="w-4 h-4 mr-2" />
                                            View on GitHub
                                        </a>
                                    </Button>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <Shield className="w-8 h-8 text-blue-500 mb-2" />
                                    <CardTitle>Reproducible Results</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-muted-foreground mb-4">
                                        Every summary is made with an open-source prompt, known data sources, and an observable model. Full reproducibility for
                                        academic standards.
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        asChild
                                    >
                                        <Link href="/blog/manifesto">
                                            View Methodology
                                        </Link>
                                    </Button>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <Users className="w-8 h-8 text-blue-500 mb-2" />
                                    <CardTitle>Community Driven</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-muted-foreground mb-4">
                                        Researchers contribute improvements, report issues, and help shape the roadmap. Built by researchers, for researchers.
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        asChild
                                    >
                                        <a href="https://github.com/khoj-ai/openpaper" target="_blank" rel="noopener noreferrer">
                                            Join Community
                                        </a>
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="w-full py-12 md:py-24 lg:py-32">
                    <div className="container px-4 md:px-6 max-w-6xl mx-auto">
                        <div className="flex flex-col items-center justify-center space-y-8 text-center">
                            <div className="space-y-4">
                                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
                                    Ready to <span className="text-primary">Supercharge</span> Your Research?
                                </h2>
                                <p className="mx-auto max-w-[600px] text-muted-foreground md:text-xl">
                                    Join researchers who trust Open Paper for reliable, cited, and transparent research analysis.
                                    Start your free trial today.
                                </p>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-4">
                                <Button size="lg" className="bg-blue-500 hover:bg-blue-600 w-full sm:w-auto" asChild>
                                    <Link href="/login">
                                        <Play className="h-4 w-4 mr-2" />
                                        Get Started
                                    </Link>
                                </Button>
                                <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
                                    <Link href="/pricing">
                                        <HandCoins className="h-4 w-4 mr-2" />
                                        Pricing
                                    </Link>
                                </Button>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-muted-foreground text-sm">
                                <div className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-primary" />
                                    No credit card required
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-primary" />
                                    Full citation tracking
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-primary" />
                                    Open source
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="flex flex-col gap-4 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t border-border/40 bg-muted/50">
                <p className="text-xs text-muted-foreground text-center sm:text-left">
                    Made with ❤️ in{" "}
                    <a
                        href="https://github.com/khoj-ai/openpaper"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground transition-colors"
                    >
                        San Francisco
                    </a>
                </p>
                <nav className="sm:ml-auto flex flex-wrap justify-center sm:justify-end gap-4 sm:gap-6">
                    <Link href="/privacy" className="text-xs hover:underline underline-offset-4 text-muted-foreground hover:text-primary">
                        Privacy Policy
                    </Link>
                    <Link href="/tos" className="text-xs hover:underline underline-offset-4 text-muted-foreground hover:text-primary">
                        Terms of Service
                    </Link>
                    <Link href="https://github.com/khoj-ai/openpaper" className="text-xs hover:underline underline-offset-4 text-muted-foreground hover:text-primary">
                        GitHub
                    </Link>
                    <Link href="/blog/manifesto" className="text-xs hover:underline underline-offset-4 text-muted-foreground hover:text-primary">
                        Manifesto
                    </Link>
                </nav>
            </footer>
        </div>
    );
}
