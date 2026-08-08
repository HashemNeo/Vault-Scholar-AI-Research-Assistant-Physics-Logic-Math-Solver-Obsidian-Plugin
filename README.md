# 🦉 Vault Scholar

**Secure Research, Math/Physics, Code Auditing & Simulation Engine for Obsidian**

Vault Scholar is a local, secure, evidence-gated research, mathematics, physics, code-auditing, and simulation engine powered by local Ollama models. Everything runs on your machine — no data leaves your computer.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔬 **Research with citations** | Deep reasoning (Gemma4 12B) synthesizes findings with citations to vault notes |
| 📸 **Snapshots & restore points** | Full vault backups with one-click restore |
| ➗ **Math/Physics derivation** | Step-by-step derivations (Mathstral) with verification |
| 🔍 **Pattern recognition** | Detects logical patterns, symmetries, and invariants |
| 🎯 **Simulation specs** | Generates detailed simulation specifications |
| 💻 **Coder agent** | Builds simulation scripts from specs (Qwen2.5-Coder) |
| 🏃 **Sandboxed execution** | Runs scripts in isolated sandboxes (Python/Node/Docker) |
| 🔒 **Code auditing** | Detects vulnerabilities in code snippets |
| 📜 **Provenance** | Every claim, equation, and script is recorded with source, model, and timestamp |
| 🔎 **Semantic search (RAG)** | Embeddings-based search across your vault |

---

## 🧠 Models

| Role | Model | Default |
|---|---|---|
| 🟢 Safe / Everyday | `qwen3:8b` | ✅ |
| 🧠 Deep Reasoning | `gemma4:12b` | |
| ➗ Math / Science | `mathstral:latest` | |
| 💻 Coding / Security | `huihui_ai/qwen2.5-coder-abliterate:7b` | |
| 🔎 Embeddings | `qwen3-embedding:0.6b` | ✅ |

---

## 🚀 Installation

### Prerequisites
- [Ollama](https://ollama.com) installed and running
- Required models pulled (see below)

### 1. Pull models
```bash
ollama pull qwen3:8b
ollama pull gemma4:12b
ollama pull mathstral:latest
ollama pull huihui_ai/qwen2.5-coder-abliterate:7b
ollama pull qwen3-embedding:0.6b
```

### 2. Install plugin
1. Copy the `vault-scholar` folder to your vault's `.obsidian/plugins/` directory
2. Restart Obsidian (or reload the vault)
3. Enable **Vault Scholar** in Settings → Community plugins

### 3. Optional: Node.js + Docker for stronger sandboxing
Run the setup script (from the vault root):
```powershell
powershell -ExecutionPolicy Bypass -File setup-vault-scholar.ps1
```
This installs Node.js and Docker Desktop, verifies models, and registers the plugin.

---

## 🔒 Security Model

By default, Vault Scholar operates in **Safe Mode**:

```
Code Execution:      🔒 SANDBOXED ONLY
Internet Research:   🔒 OFF until requested
Vault Writing:       🔒 APPROVAL REQUIRED
Script Execution:    🔒 APPROVAL REQUIRED
External Sources:    🔒 VERIFY BEFORE VAULT WRITE
```

All security settings can be configured in **Settings → Vault Scholar**.

---

## 🏖️ Sandboxing

Three levels of code execution isolation:

| Mode | Isolation | Requires |
|---|---|---|
| **Python** (default) | Subprocess isolation, temp dirs, no network, timeout+kill | Python |
| **Node** | `vm` sandbox, no require/process/network, CPU limit | Node.js |
| **Docker** | Container isolation, `--network none`, read-only FS, resource limits | Docker |

---

## 📜 Provenance

Every operation records a provenance entry with:
- **ID** (SHA-256 hash)
- **Timestamp**
- **Type** (research, derivation, pattern_analysis, simulation_spec, simulation_script, claim)
- **Content** (with content hash)
- **Source note**
- **Model** used
- **Citations**
- **Verification status**

View provenance records via the **View Provenance** command.

---

## 📸 Snapshots

- Create snapshots manually or before risky operations
- Snapshots exclude `.obsidian`, `.trash`, `.git`, and `.copilot-index`
- Restore any snapshot with approval
- Configurable max snapshot count (default: 20)

---

## ⌨️ Commands

| Command | Description |
|---|---|
| Open Vault Scholar | Open the main control panel |
| Research with citations | Deep research with vault context |
| Derive math/physics | Step-by-step derivation |
| Analyze patterns | Symmetries, invariants, patterns |
| Audit code | Vulnerability detection |
| Generate simulation spec | Create simulation specification |
| Build simulation script | Generate script from spec |
| Run script in sandbox | Execute in isolated sandbox |
| Semantic search | RAG-based vault search |
| Index vault | Build RAG index |
| Create snapshot | Backup vault |
| List snapshots | View available snapshots |
| Restore snapshot | Restore from backup |
| View provenance | View provenance records |
| Switch model | Change active model |
| Check loaded models | View VRAM usage |
| Write to note | Create a new note |

---

## 🖥️ Hardware Requirements

- **Minimum:** 8GB VRAM (RTX 3060 8GB or similar)
- **Recommended:** 12GB VRAM (RTX 3060 12GB)
- **RAM:** 16GB+ (32GB recommended)
- **Storage:** ~25GB for all models

### VRAM Strategy
- Embeddings model (639MB) stays loaded for instant RAG
- Main task model is swapped as needed
- Conservative context windows (4096 default, 8192 for long tasks)

---

## 🔧 Troubleshooting

**"Ollama error"** — Ensure Ollama is running (`ollama serve` or the desktop app).

**"Model not found"** — Pull the required models (see above).

**"Python not found"** — Install Python and ensure it's on PATH.

**"Docker not found"** — Install Docker Desktop and restart your computer.

---

## ⚠️ Disclaimer

Vault Scholar is a research and development tool. AI-generated content, including derivations, code, and research, should be independently verified before use in critical applications. Code execution is sandboxed, but no sandbox is perfect — review scripts before running them.

---

## 📄 License

MIT