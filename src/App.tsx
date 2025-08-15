import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, CalendarClock, Tag, Trash2, Edit3, Star, Brain, CheckCircle2, Filter, Search, Flag, Inbox, ChevronDown, ChevronUp, Sun, Moon, Settings, TimerReset, ListChecks, Sparkles, Upload, Download, Columns3, List as ListIcon, Check, X } from "lucide-react";
import * as chrono from "chrono-node";

// shadcn/ui imports
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// ------------------
// Types
// ------------------

type Priority = "low" | "medium" | "high";

type Task = {
  id: string;
  title: string;
  notes?: string;
  createdAt: number; // epoch ms
  due?: number; // epoch ms
  tags: string[];
  project?: string;
  priority: Priority;
  done: boolean;
  subtasks?: { id: string; title: string; done: boolean }[];
};

// ------------------
// Utilities
// ------------------

const uid = () => Math.random().toString(36).slice(2, 10);

const formatDate = (ms?: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

// Estimate priority from text and due date proximity
function inferPriority(text: string, due?: number): Priority {
  const t = text.toLowerCase();
  if (/[!](high|important|urgent)/.test(t) || /\b(urgent|asap|critical|today)\b/.test(t)) return "high";
  if (/[!](med|medium)/.test(t)) return "medium";
  if (/[!](low)/.test(t)) return "low";
  if (due) {
    const hours = (due - Date.now()) / 36e5;
    if (hours <= 24) return "high";
    if (hours <= 72) return "medium";
  }
  if (/\b(review|plan|someday)\b/.test(t)) return "low";
  return "medium";
}

// Extract #tags and !priority tokens from text
function extractTokens(text: string) {
  const tags = Array.from(new Set(Array.from(text.matchAll(/#([\p{L}\p{N}_:-]+)/gu)).map((m) => m[1].toLowerCase())));
  const prMatch = text.match(/!(high|med(?:ium)?|low)/i);
  let priority: Priority | undefined;
  if (prMatch) {
    const p = prMatch[1].toLowerCase();
    priority = p.startsWith("high") ? "high" : p.startsWith("low") ? "low" : "medium";
  }
  const cleaned = text
    .replace(/#([\p{L}\p{N}_:-]+)/gu, "")
    .replace(/!(high|med(?:ium)?|low)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { cleaned, tags, priority };
}

// Parse natural language to Task fields
function parseTask(input: string): Partial<Task> {
  const { cleaned, tags, priority } = extractTokens(input);
  const parsed = chrono.parse(cleaned, new Date(), { forwardDate: true });
  let due: number | undefined;
  let title = cleaned;
  if (parsed.length) {
    const first = parsed[0];
    due = first.date().getTime();
    const start = first.index ?? 0;
    const end = (first.index ?? 0) + (first.text?.length ?? 0);
    title = (cleaned.slice(0, start) + " " + cleaned.slice(end)).replace(/\s{2,}/g, " ").trim();
  }
  const inferred = inferPriority(cleaned, due);
  return {
    title: title || cleaned,
    due,
    tags,
    priority: priority ?? inferred,
  };
}

function saveToFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}

// Optional: plug in your LLM here (kept simple & safe by default)
async function callLLM(prompt: string, apiKey?: string): Promise<string> {
  if (!apiKey) {
    if (/summarize/i.test(prompt)) return "Here’s a quick plan: focus on high-priority items due today, then tackle medium ones due this week. Leave low-priority tasks for later.";
    if (/break down/i.test(prompt)) return "Subtasks: 1) Clarify scope, 2) List resources, 3) Set milestones, 4) Schedule work blocks, 5) Review & adjust.";
    return "(Mock AI) I’d prioritize urgent, time-bound tasks first, then group related work for flow. Add deadlines when possible.";
  }
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a concise productivity assistant." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
    });
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    return text || "No response from the model.";
  } catch {
    return "AI call failed. Using local heuristic instead.";
  }
}

// ------------------
// Main Component
// ------------------

export default function AITaskApp() {
  // Theme
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem("ai_tasks_theme");
    return stored ? stored === "dark" : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    localStorage.setItem("ai_tasks_theme", dark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Data
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const raw = localStorage.getItem("ai_tasks_data");
      return raw ? (JSON.parse(raw) as Task[]) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem("ai_tasks_data", JSON.stringify(tasks));
  }, [tasks]);

  // UI state
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState("");
  const [filterText, setFilterText] = useState("");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [aiKey, setAiKey] = useState<string>(
    localStorage.getItem("aiKey") || import.meta.env.VITE_OPENAI_API_KEY || ""
  );
  useEffect(() => {
    if (aiKey) localStorage.setItem("aiKey", aiKey);
    else localStorage.removeItem("aiKey");
  }, [aiKey]);

  const [aiWorking, setAiWorking] = useState(false);
  const [aiOutput, setAiOutput] = useState<string>("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [view, setView] = useState<"list" | "kanban">("list"); // NEW

  const inputRef = useRef<HTMLInputElement>(null);

  // Derived
  const allTags = useMemo(() => Array.from(new Set(tasks.flatMap((t) => t.tags))).sort(), [tasks]);
  const allProjects = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.project).filter(Boolean) as string[])).sort(),
    [tasks]
  );


  // For showing current selection in the Filters button
  const filterSummary = useMemo(() => {
    const parts = [];
    if (filterTag) parts.push(`#${filterTag}`);
    if (filterProject) parts.push(`Project: ${filterProject}`);
    return parts.join(" · ");
  }, [filterTag, filterProject]);

  // Filtering used by both views
  const filtered = useMemo(() => {
    return tasks
      .filter((t) => (showDone ? true : !t.done))
      .filter((t) => (filterTag ? t.tags.includes(filterTag) : true))
      .filter((t) => (filterProject ? t.project === filterProject : true))
      .filter((t) => {
        const hay = (t.title + " " + (t.notes || "") + " " + t.tags.join(" ")).toLowerCase();
        return hay.includes(filterText.toLowerCase());
      });
  }, [tasks, showDone, filterText, filterTag, filterProject]);

  // List view ordering
  const visible = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const pRank = { high: 0, medium: 1, low: 2 } as const;
      if (pRank[a.priority] !== pRank[b.priority]) return pRank[a.priority] - pRank[b.priority];
      if ((a.due || Infinity) !== (b.due || Infinity)) return (a.due || Infinity) - (b.due || Infinity);
      return a.createdAt - b.createdAt;
    });
  }, [filtered]);

  // Kanban bucketing
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const weekEnd = endOfDay(addDays(new Date(), 7));

  type BucketKey = "today" | "week" | "later" | "done";
  const [dropCol, setDropCol] = useState<BucketKey | null>(null);
  const buckets = useMemo(() => {
    const out: Record<BucketKey, Task[]> = { today: [], week: [], later: [], done: [] };
    for (const t of filtered) {
      if (t.done) {
        out.done.push(t);
      } else if (t.due && t.due <= todayEnd.getTime() && t.due >= todayStart.getTime()) {
        out.today.push(t);
      } else if (t.due && t.due > todayEnd.getTime() && t.due <= weekEnd.getTime()) {
        out.week.push(t);
      } else {
        out.later.push(t);
      }
    }
    // Sort inside columns
    const byUrgency = (a: Task, b: Task) => {
      const pRank = { high: 0, medium: 1, low: 2 } as const;
      if (pRank[a.priority] !== pRank[b.priority]) return pRank[a.priority] - pRank[b.priority];
      return (a.due || Infinity) - (b.due || Infinity);
    };
    out.today.sort(byUrgency);
    out.week.sort(byUrgency);
    out.later.sort(byUrgency);
    out.done.sort((a, b) => (a.due || Infinity) - (b.due || Infinity));
    return out;
  }, [filtered, todayEnd, todayStart, weekEnd]);

  // Actions
  function addTaskFromInput() {
    if (!input.trim()) return;
    const base = parseTask(input.trim());
    const t: Task = {
      id: uid(),
      title: base.title || input.trim(),
      notes: notes.trim() || undefined,
      createdAt: Date.now(),
      due: base.due,
      tags: base.tags || [],
      project: base.tags?.find((x) => x.startsWith("proj:"))?.slice(5),
      priority: base.priority || "medium",
      done: false,
      subtasks: [],
    };
    setTasks((arr) => [t, ...arr]);
    setInput("");
    setNotes("");
    inputRef.current?.focus();
  }

  function toggleDone(id: string) {
    setTasks((arr) => arr.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function removeTask(id: string) {
    if (!confirm("Delete this task?")) return;
    setTasks((arr) => arr.filter((t) => t.id !== id));
  }

  function updateTask(updated: Task) {
    setTasks((arr) => arr.map((t) => (t.id === updated.id ? updated : t)));
    setEditing(null);
  }

  function bumpPriority(id: string, dir: 1 | -1) {
    const order: Priority[] = ["low", "medium", "high"];
    setTasks((arr) =>
      arr.map((t) => {
        if (t.id !== id) return t;
        const idx = order.indexOf(t.priority);
        const next = order[clamp(idx + dir, 0, order.length - 1)];
        return { ...t, priority: next };
      })
    );
  }

  // Quick scheduling for Kanban moves
  function moveToBucket(id: string, bucket: BucketKey) {
    setTasks((arr) =>
      arr.map((t) => {
        if (t.id !== id) return t;
        if (bucket === "done") return { ...t, done: true };
        if (bucket === "later") return { ...t, due: undefined, done: false };
        if (bucket === "today") {
          const d = new Date();
          d.setHours(17, 0, 0, 0); // today 5pm
          return { ...t, due: d.getTime(), done: false };
        }
        // "week"
        const d = addDays(new Date(), 3);
        d.setHours(9, 0, 0, 0); // ~3 days at 9am
        return { ...t, due: d.getTime(), done: false };
      })
    );
  }

  async function summarizeDay() {
    setAiWorking(true);
    const today = new Date();
    const upcoming = tasks
      .filter((t) => !t.done)
      .filter((t) => (t.due ? new Date(t.due).toDateString() === today.toDateString() : false))
      .map((t) => `• ${t.title}${t.due ? ` (due ${new Date(t.due).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : ""}`)
      .join("\n");

    const prompt = `Summarize my day and propose a focused 3-step plan. Today's tasks (not done):\n${upcoming || "(none listed)"}`;
    const text = await callLLM(prompt, aiKey || undefined);
    setAiOutput(text);
    setAiWorking(false);
  }

  async function breakDownTask(task: Task) {
    setAiWorking(true);
    const prompt = `Break down this task into 3-6 clear subtasks with verbs: "${task.title}". Consider due date: ${task.due ? new Date(task.due).toISOString() : "none"}. Return a simple list.`;
    const text = await callLLM(prompt, aiKey || undefined);
    setAiOutput(text);
    setAiWorking(false);
  }

  function importJSON(jsonText: string) {
    try {
      const parsed = JSON.parse(jsonText) as Task[];
      if (!Array.isArray(parsed)) throw new Error("Invalid format");
      const cleaned: Task[] = parsed.map((t) => ({
        id: t.id || uid(),
        title: t.title || "Untitled",
        notes: t.notes || "",
        createdAt: t.createdAt || Date.now(),
        due: t.due || undefined,
        tags: Array.isArray(t.tags) ? t.tags : [],
        project: t.project || undefined,
        priority: (t.priority as Priority) || "medium",
        done: Boolean(t.done),
        subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
      }));
      setTasks(cleaned);
    } catch (e) {
      alert("Couldn't import: " + (e as Error).message);
    }
  }

  // Keyboard: Enter to add
  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addTaskFromInput();
    }
  }

  // ------------------
  // Render
  // ------------------

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <Brain className="h-7 w-7" />
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">AI Task App</h1>
            <Badge className="ml-2" variant="secondary">
              beta
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setDark((d) => !d)} title="Toggle theme" aria-label="Toggle theme">
              {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="end">
                <DropdownMenuLabel>AI (optional)</DropdownMenuLabel>
                <div className="p-2">
                  <Label htmlFor="key" className="text-xs">
                    OpenAI-compatible API Key
                  </Label>
                  <Input
                    id="key"
                    type="password"
                    placeholder="sk-..."
                    autoComplete="off"
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Leave blank to use built-in local suggestions.</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Data</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => saveToFile("ai-tasks.json", JSON.stringify(tasks, null, 2))}>
                  <Download className="h-4 w-4 mr-2" /> Export JSON
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const inp = document.createElement("input");
                    inp.type = "file";
                    inp.accept = "application/json";
                    inp.onchange = async () => {
                      const file = inp.files?.[0];
                      if (file) {
                        const text = await readFile(file);
                        importJSON(text);
                      }
                    };
                    inp.click();
                  }}
                >
                  <Upload className="h-4 w-4 mr-2" /> Import JSON
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    localStorage.removeItem("ai_tasks_data");
                    setTasks([]);
                  }}
                >
                  <TimerReset className="h-4 w-4 mr-2" /> Reset tasks
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Composer */}
        <Card className="mb-6 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add a task by typing naturally
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Examples: "Email Alex about Q3 report tomorrow 3pm #work !high" • "Buy milk next Friday #errands"
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col md:flex-row gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="What needs doing? Include dates, #tags, and !priority"
              />
              <Button onClick={addTaskFromInput} className="shrink-0">
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" rows={2} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" /> Dates parsed by chrono-node
              </span>
              <span className="flex items-center gap-1">
                <Tag className="h-3.5 w-3.5" /> Use #tags (e.g., #work or #proj:Website)
              </span>
              <span className="flex items-center gap-1">
                <Flag className="h-3.5 w-3.5" /> Set priority with !high/!med/!low
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Search tasks…" className="pl-8 w-64" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  {filterSummary ? `Filters · ${filterSummary}` : "Filters"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60">
                <DropdownMenuLabel>Tag</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setFilterTag(null)}>
                  <div className="flex items-center gap-2">
                    <Check className={`h-4 w-4 ${!filterTag ? "opacity-100" : "opacity-0"}`} />
                    <span>(any)</span>
                  </div>
                </DropdownMenuItem>
                {allTags.map((t) => (
                  <DropdownMenuItem key={t} onSelect={() => setFilterTag(t)}>
                    <div className="flex items-center gap-2">
                      <Check className={`h-4 w-4 ${filterTag === t ? "opacity-100" : "opacity-0"}`} />
                      <span>#{t}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Project</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setFilterProject(null)}>
                  <div className="flex items-center gap-2">
                    <Check className={`h-4 w-4 ${!filterProject ? "opacity-100" : "opacity-0"}`} />
                    <span>(any)</span>
                  </div>
                </DropdownMenuItem>
                {allProjects.map((p) => (
                  <DropdownMenuItem key={p} onSelect={() => setFilterProject(p)}>
                    <div className="flex items-center gap-2">
                      <Check className={`h-4 w-4 ${filterProject === p ? "opacity-100" : "opacity-0"}`} />
                      <span>{p}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Other</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setShowDone((v) => !v)}>
                  <div className="flex items-center justify-between w-full">
                    <span>Show completed</span>
                    <Switch checked={showDone} onCheckedChange={setShowDone} />
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* View toggle */}
          <div className="ml-auto flex items-center gap-2">
            <div className="rounded-lg border p-1 flex">
              <Button
                variant={view === "list" ? "default" : "ghost"}
                size="sm"
                className="gap-2"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                aria-label="List view"
              >
                <ListIcon className="h-4 w-4" />
                List
              </Button>
              <Button
                variant={view === "kanban" ? "default" : "ghost"}
                size="sm"
                className="gap-2"
                onClick={() => setView("kanban")}
                aria-pressed={view === "kanban"}
                aria-label="Kanban view"
              >
                <Columns3 className="h-4 w-4" />
                Kanban
              </Button>
            </div>
            <Button variant="secondary" onClick={summarizeDay} disabled={aiWorking}>
              <Sparkles className="h-4 w-4 mr-2" />
              {aiWorking ? "Thinking…" : "Summarize my day"}
            </Button>
          </div>
        </div>

        {/* Animated filter chips */}
        <AnimatePresence initial={false}>
          {(filterTag || filterProject) && (
            <motion.div
              key="chip-row"
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex flex-wrap items-center gap-2 mb-3"
            >
              {/* Tag chip */}
              <AnimatePresence initial={false}>
                {filterTag && (
                  <motion.div
                    key={`chip-tag-${filterTag}`}
                    layout
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                    <Badge
                      variant="outline"
                      className="gap-1 cursor-pointer"
                      onClick={() => setFilterTag(null)}
                      aria-label={`Clear tag filter #${filterTag}`}
                      title="Clear tag filter"
                    >
                      #{filterTag}
                      <button
                        className="ml-1 inline-flex"
                        onClick={e => {
                          e.stopPropagation();
                          setFilterTag(null);
                        }}
                        aria-label="Clear tag filter"
                        title="Clear tag filter"
                        type="button"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </Badge>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Project chip */}
              <AnimatePresence initial={false}>
                {filterProject && (
                  <motion.div
                    key={`chip-proj-${filterProject}`}
                    layout
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                    <Badge
                      variant="outline"
                      className="gap-1 cursor-pointer"
                      onClick={() => setFilterProject(null)}
                      aria-label={`Clear project filter ${filterProject}`}
                      title="Clear project filter"
                    >
                      Project: {filterProject}
                      <button
                        className="ml-1 inline-flex"
                        onClick={e => {
                          e.stopPropagation();
                          setFilterProject(null);
                        }}
                        aria-label="Clear project filter"
                        title="Clear project filter"
                        type="button"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </Badge>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Clear all */}
              <motion.div
                key="chip-clear-all"
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterTag(null);
                    setFilterProject(null);
                  }}
                  aria-label="Clear all filters"
                  type="button"
                >
                  Clear all
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>


        {/* AI output */}
        {aiOutput && (
          <Card className="mb-4 border-dashed">
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Assistant
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setAiOutput("")}>
                Dismiss
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{aiOutput}</pre>
            </CardContent>
          </Card>
        )}

        {/* Views */}
        {view === "list" ? (
          <>
            {/* List + Focus */}
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Inbox className="h-5 w-5" /> Inbox
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <AnimatePresence>
                      {visible.map((t) => (
                        <motion.div
                          key={t.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className={`rounded-2xl p-3 border ${t.done ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                            <Button
                              variant={t.done ? "secondary" : "outline"}
                              size="icon"
                              className="mt-0.5"
                              onClick={() => toggleDone(t.id)}
                              aria-label={t.done ? "Mark as not done" : "Mark as done"}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">{t.title}</span>
                                {t.priority === "high" && (
                                  <Badge variant="destructive">
                                    <Star className="h-3.5 w-3.5 mr-1" />
                                    High
                                  </Badge>
                                )}
                                {t.priority === "medium" && <Badge variant="secondary">Medium</Badge>}
                                {t.priority === "low" && <Badge>Low</Badge>}
                                {t.due && (
                                  <Badge variant={Date.now() > t.due && !t.done ? "destructive" : "outline"}>
                                    <CalendarClock className="h-3.5 w-3.5 mr-1" />
                                    {formatDate(t.due)}
                                  </Badge>
                                )}
                              </div>
                              {t.notes && <p className="text-sm text-muted-foreground mt-1">{t.notes}</p>}
                              {t.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {t.tags.map((tag) => (
                                    <Badge key={tag} variant="outline" className="rounded-full">
                                      #{tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              {t.subtasks && t.subtasks.length > 0 && (
                                <div className="mt-2 pl-1 space-y-1">
                                  {t.subtasks.map((s) => (
                                    <label key={s.id} className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={s.done}
                                        onChange={(e) =>
                                          updateTask({
                                            ...t,
                                            subtasks: t.subtasks!.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)),
                                          })
                                        }
                                      />
                                      <span className={s.done ? "line-through text-muted-foreground" : ""}>{s.title}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-1">
                              <Button aria-label="Increase priority" variant="ghost" size="icon" onClick={() => bumpPriority(t.id, +1)}>
                                <ChevronUp className="h-4 w-4" />
                              </Button>
                              <Button aria-label="Decrease priority" variant="ghost" size="icon" onClick={() => bumpPriority(t.id, -1)}>
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                            </div>
                            <div className="flex flex-col gap-1">
                              <Button aria-label="Edit task" variant="ghost" size="icon" onClick={() => setEditing(t)}>
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button aria-label="Break down with AI" variant="ghost" size="icon" onClick={() => breakDownTask(t)}>
                                <ListChecks className="h-4 w-4" />
                              </Button>
                              <Button aria-label="Delete task" variant="ghost" size="icon" onClick={() => removeTask(t.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {visible.length === 0 && <p className="text-sm text-muted-foreground">No tasks match your filters.</p>}
                  </div>
                </CardContent>
              </Card>

              {/* Focus card */}
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Star className="h-5 w-5" /> Focus
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {tasks
                      .filter((t) => !t.done)
                      .sort((a, b) => {
                        const pRank = { high: 0, medium: 1, low: 2 } as const;
                        if (pRank[a.priority] !== pRank[b.priority]) return pRank[a.priority] - pRank[b.priority];
                        return (a.due || Infinity) - (b.due || Infinity);
                      })
                      .slice(0, 5)
                      .map((t) => (
                        <div key={t.id} className="p-3 rounded-2xl border flex items-center justify-between">
                          <div>
                            <div className="font-medium">{t.title}</div>
                            <div className="text-xs text-muted-foreground">{t.due ? `Due ${formatDate(t.due)}` : "No due date"}</div>
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => breakDownTask(t)}>
                            <Sparkles className="h-4 w-4 mr-2" />
                            Break down
                          </Button>
                        </div>
                      ))}
                  </div>
                </CardContent>
                <CardFooter>
                  <p className="text-xs text-muted-foreground">Top 5 by priority and urgency.</p>
                </CardFooter>
              </Card>
            </div>
          </>
        ) : (
          <>
            {/* KANBAN */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {([
                { key: "today", title: "Today", color: "border-foreground/20" },
                { key: "week", title: "This Week", color: "border-foreground/20" },
                { key: "later", title: "Later", color: "border-foreground/20" },
                { key: "done", title: "Done", color: "border-foreground/20" },
              ] as { key: BucketKey; title: string; color: string }[]).map((col) => (
                <Card key={col.key} className={`shadow-sm ${col.color}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>{col.title}</span>
                      <Badge variant="secondary">
                        <motion.span layout>{buckets[col.key].length}</motion.span>
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <motion.div
                      layout
                      className="space-y-3 min-h-[120px] rounded-xl transition-colors data-[drop-over=true]:ring-2 data-[drop-over=true]:ring-primary/40 data-[drop-over=true]:bg-muted/30"
                      data-drop-over={dropCol === col.key}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnter={() => setDropCol(col.key)}
                      onDragLeave={() => setDropCol((prev) => (prev === col.key ? null : prev))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/plain");
                        if (id) moveToBucket(id, col.key);
                        setDropCol(null);
                      }}
                    >
                      <AnimatePresence mode="popLayout" initial={false}>
                        {buckets[col.key].map((t) => (
                          <motion.div
                            key={t.id}
                            layout
                            layoutId={`task-${t.id}`}
                            initial={{ opacity: 0, y: 6, scale: 0.99 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.99 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="rounded-xl border p-3 bg-background/60"
                          >
                            {/* Drag handle */}
                            <div
                              draggable
                              onDragStart={(e: React.DragEvent<HTMLDivElement>) => {
                                e.dataTransfer.setData("text/plain", t.id);
                              }}
                              aria-grabbed="true"
                            >
                              <div className="flex items-start gap-3">
                                <Button
                                  variant={t.done ? "secondary" : "outline"}
                                  size="icon"
                                  className="mt-0.5"
                                  onClick={() => toggleDone(t.id)}
                                  aria-label={t.done ? "Mark as not done" : "Mark as done"}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium">{t.title}</span>
                                    {t.priority === "high" && (
                                      <Badge variant="destructive">
                                        <Star className="h-3.5 w-3.5 mr-1" />
                                        High
                                      </Badge>
                                    )}
                                    {t.priority === "medium" && <Badge variant="secondary">Medium</Badge>}
                                    {t.priority === "low" && <Badge>Low</Badge>}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {t.due ? `Due ${formatDate(t.due)}` : "No due date"}
                                  </div>
                                  {t.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {t.tags.map((tag) => (
                                        <Badge key={tag} variant="outline" className="rounded-full text-[10px]">
                                          #{tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Quick actions */}
                            <div className="mt-2 flex flex-wrap gap-1">
                              {col.key !== "today" && (
                                <Button size="sm" variant="outline" onClick={() => moveToBucket(t.id, "today")}>
                                  Today
                                </Button>
                              )}
                              {col.key !== "week" && (
                                <Button size="sm" variant="outline" onClick={() => moveToBucket(t.id, "week")}>
                                  This week
                                </Button>
                              )}
                              {col.key !== "later" && (
                                <Button size="sm" variant="outline" onClick={() => moveToBucket(t.id, "later")}>
                                  Later
                                </Button>
                              )}
                              {col.key !== "done" && (
                                <Button size="sm" variant="secondary" onClick={() => moveToBucket(t.id, "done")}>
                                  Done
                                </Button>
                              )}
                              <span className="flex-1" />
                              <Button aria-label="Edit task" size="icon" variant="ghost" onClick={() => setEditing(t)}>
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button aria-label="Break down with AI" size="icon" variant="ghost" onClick={() => breakDownTask(t)}>
                                <ListChecks className="h-4 w-4" />
                              </Button>
                              <Button aria-label="Delete task" size="icon" variant="ghost" onClick={() => removeTask(t.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </motion.div>
                        ))}

                        {buckets[col.key].length === 0 && (
                          <motion.p
                            key="empty"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.12 }}
                            className="text-xs text-muted-foreground italic"
                          >
                            No cards here.
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* Edit dialog */}
        <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
               <DialogTitle>Edit task</DialogTitle>
               <DialogDescription>Update the title, notes, due date, priority, and tags for this task.</DialogDescription>
            </DialogHeader>
            {editing && (
              <div className="space-y-3">
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                <Textarea value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={3} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Due date (parsed)</Label>
                    <Input
                      placeholder="e.g., next Tue 3pm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const p = parseTask((e.target as HTMLInputElement).value);
                          setEditing({ ...editing, due: p.due });
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                    <div className="text-xs text-muted-foreground mt-1">{editing.due ? formatDate(editing.due) : "No due date"}</div>
                  </div>
                  <div>
                    <Label className="text-xs">Priority</Label>
                    <div className="flex items-center gap-2 mt-2">
                      {(["low", "medium", "high"] as Priority[]).map((p) => (
                        <Button key={p} variant={editing.priority === p ? "default" : "outline"} size="sm" onClick={() => setEditing({ ...editing, priority: p })}>
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Tags (#tag)</Label>
                  <Input
                    placeholder="#work #proj:Website"
                    defaultValue={editing.tags.map((t) => `#${t}`).join(" ")}
                    onBlur={(e) => {
                      const tags = Array.from(new Set(Array.from(e.target.value.matchAll(/#([\p{L}\p{N}_:-]+)/gu)).map(m => m[1].toLowerCase())));
                      setEditing({ ...editing, tags, project: tags.find((x) => x.startsWith("proj:"))?.slice(5) });
                    }}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              {editing && <Button onClick={() => updateTask(editing)}>Save</Button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Footer help */}
        <div className="text-xs text-muted-foreground mt-8 space-y-1">
          <p>
            Tips: Type dates naturally ("tomorrow 3pm"), add #tags, set !priority, and include <code>#proj:Name</code> to track a project. Your data
            stays in your browser (localStorage).
          </p>
        </div>
      </div>
    </div>
  );
}
