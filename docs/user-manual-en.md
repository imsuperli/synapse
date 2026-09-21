# Synapse User Manual (English)

## Table of Contents

1. [Installation and Startup](#installation-and-startup)
2. [Basic Concepts](#basic-concepts)
3. [Interface Layout](#interface-layout)
4. [Creating and Managing Windows](#creating-and-managing-windows)
5. [Creating and Managing Window Groups](#creating-and-managing-window-groups)
6. [Window Status and Icon Descriptions](#window-status-and-icon-descriptions)
7. [Keyboard Shortcuts](#keyboard-shortcuts)
8. [SSH Image Paste](#ssh-image-paste)
9. [Project Link Configuration](#project-link-configuration)
10. [Quick Navigation](#quick-navigation)
11. [Workspace Save and Restore](#workspace-save-and-restore)
12. [FAQ](#faq)

---

## Installation and Startup

### Option 1: Download Installer (Recommended)

1. Visit the [Releases page](https://github.com/imsuperli/synapse/releases)
2. Download the installer for your operating system:
   - Windows: `.exe` installer or `.zip` archive
   - macOS: `.dmg` disk image
   - Linux: `.AppImage` or `.deb`/`.rpm` package
3. Install and launch the application

### Option 2: Run from Source (Developers)

```bash
# 1. Clone the repository
git clone https://github.com/imsuperli/synapse.git
cd synapse

# 2. Install dependencies (Note: requires xterm.js custom package)
npm install

# 3. Start development environment
npm run dev
```

**Important**: Before running from source, please read [xterm.js Custom Package Constraint](xterm-custom-package-constraint.md).

---

## Basic Concepts

Synapse uses a three-layer nested structure to organize terminal sessions:

```
Window Group (WindowGroup)
  └─ Window
      └─ Pane
```

### Pane

**Definition**: The smallest terminal unit, corresponding to a PTY process.

**Features**:
- Each pane runs an independent shell process
- Has its own status (Running, WaitingForInput, Paused, Exited)
- Can be independently started, paused, or stopped

### Window

**Definition**: A container that holds one or more panes, supporting split-pane layout.

**Features**:
- Can contain multiple panes (created through splitting)
- Panes can be split horizontally or vertically
- Supports nested splits (recursive tree layout structure)
- Window status is determined by the status of all its panes

**Status Calculation Rule**:
```
Window Status = Highest priority pane status among all panes in the window
Priority: Running > WaitingForInput > Paused > Exited
```

### Window Group

**Definition**: A logical grouping containing multiple windows, used to organize related terminal sessions.

**Features**:
- Can contain multiple windows
- Supports batch operations (Start All, Pause All, Archive, Delete)
- Can be displayed in a dedicated GroupView with split-pane layout
- Group status is determined by the status of all its windows

**Status Calculation Rule**:
```
Group Status = Highest priority window status among all windows in the group
Each window's status = Highest priority pane status among all panes in the window
Priority: Running > WaitingForInput > Paused > Exited
```

---

## Interface Layout

Synapse provides two main views:

### Unified View

- **Homepage Card View**: Displays all windows and window groups as cards
- **Window Cards**: Shows individual window information (name, path, Git branch, status, project links)
- **Group Cards**: Shows window group information (name, window count, status of each window)
- **Action Buttons**: Start, Pause, Archive, Delete, etc.

### Terminal View

- **Full-screen Terminal Interface**: Immersive terminal operation experience
- **Sidebar**: Displays all window list, supports quick switching
- **Quick Switcher**: Activated by `Ctrl+Tab`, supports fuzzy search
- **Status Bar**: Shows current window information and Claude StatusLine

---

## Creating and Managing Windows

### Create New Window

1. In unified view, click the "New Window" button
2. Enter window name and working directory
3. Click "Create"

### Start Window

- Windows are created in paused state by default
- Click the "Start" button on the window card to start the PTY process
- Or click the "Start" button in the top toolbar in terminal view

### Pause Window

- Click the "Pause" button to pause the PTY process
- Can be restarted after pausing

### Archive Window

- Click the "Archive" button to move the window to the archive area
- Archived windows are not displayed in the main list
- Can view and restore archived windows in the archive area

### Delete Window

- Click the "Delete" button to permanently delete the window
- Deletion is irreversible, use with caution

### Split Panes

In terminal view:
1. Right-click on the pane area
2. Select "Split Horizontally" or "Split Vertically"
3. A new pane will be created next to the current pane

---

## Creating and Managing Window Groups

### Create Window Group

1. In unified view, select multiple windows (hold Ctrl and click)
2. Click the "Create Window Group" button
3. Enter group name
4. Choose layout direction (horizontal or vertical)
5. Click "Create"

### Open Window Group

- Click on a group card to enter GroupView
- GroupView displays all windows in the group in split-pane layout
- Can freely switch and operate between windows

### Batch Operations

Window groups support the following batch operations:

- **Start All**: Start PTY processes for all windows in the group
- **Pause All**: Pause PTY processes for all windows in the group
- **Archive**: Move the entire window group to the archive area
- **Delete**: Delete the entire window group (windows themselves are preserved)

### Window Group Status Icons

#### Status Icons in Homepage Cards

- Displays **multiple status icons**, each representing a window in the group
- Each icon shows the status of that window
- The badge number in the top-left corner of each icon indicates the pane count of that window

**Example**:
```
Window Group contains:
- Window A: 3 panes (2 Running, 1 WaitingForInput)
  → Window A status = Running
- Window B: 2 panes (1 WaitingForInput, 1 Paused)
  → Window B status = WaitingForInput

Display result: [❤️₃] [⌨️₂]
```

#### Status Icons in Sidebar

- Displays a **single status icon**
- Shows the overall status of the window group (highest priority among all window statuses)
- The badge number in the top-left corner indicates the window count in the group

**Example**:
```
Window Group contains:
- Window A status = Running
- Window B status = WaitingForInput

Group status = Running (highest priority)
Window count = 2

Display result: [❤️₂]
```

---

## SSH Image Paste

When the active pane is an SSH session, using the normal paste shortcut first checks whether the local clipboard currently contains an image.

- If the clipboard contains an image, the app uploads it to a remote directory and shows a success notice at the top of the window.
- By default, the remote image path is copied back to the local clipboard so you can paste it manually into `codex`, `claude`, shell commands, or editors.
- If the clipboard is empty or does not contain an image, no upload is attempted and normal text paste continues unchanged.

### Configurable Options

In `Settings -> Advanced -> SSH Terminal`, you can configure:

- whether SSH image paste upload is enabled
- where images are stored: current directory, temporary cache directory, or a custom directory
- whether the remote path should be copied after upload
- the maximum image size in MB

### Upload Location Behavior

- Current directory: prefers the active SSH pane working directory, then falls back to `~` or `/tmp`
- Temporary cache directory: prefers `~/.cache/synapse/images`, then falls back to `/tmp`
- Custom directory: uses the configured remote directory and attempts `mkdir -p` when needed

### Failures and Limits

- Images larger than the configured max size are rejected before upload with a clear error message
- Upload can fail if the SSH connection is broken, the target directory is not writable, or the remote disk is full
- The current implementation only handles images, not generic files or other clipboard object types

---

## Window Status and Icon Descriptions

### Status Types

| Status | Icon | Meaning | Description |
| --- | --- | --- | --- |
| Running | ❤️ Heartbeat | Process is running | Output is being generated, process is active |
| WaitingForInput | ⌨️ Keyboard | Waiting for user input | Process is idle, waiting for commands |
| Paused | ⏸️ Pause | Process is paused | PTY process not started or paused |
| Exited | (TBD) | Process has exited | PTY process has terminated |

### Status Priority

When a window or window group contains multiple panes/windows, the highest priority status is displayed:

```
Running > WaitingForInput > Paused > Exited
```

### Badge Numbers

- **Window Cards**: Shows the pane count of that window
- **Group Cards (Homepage)**: Each icon shows the pane count of the corresponding window
- **Group Cards (Sidebar)**: Shows the window count in the group

---

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Function |
| --- | --- |
| `Ctrl+Tab` | Open quick switcher |
| `Ctrl+Ctrl` | Open quick navigation panel (double-tap Ctrl) |
| `Ctrl+,` | Open settings panel |

### Terminal View Shortcuts

| Shortcut | Function |
| --- | --- |
| `Ctrl+B` | Toggle sidebar expand/collapse |
| `Ctrl+1~9` | Switch to Nth window |
| `Ctrl+Enter` | Insert newline in terminal |
| `Shift+Enter` | Insert newline in terminal |

### Quick Switcher Shortcuts

| Shortcut | Function |
| --- | --- |
| `↑` / `↓` | Select window up/down |
| `Tab` | Next window |
| `Shift+Tab` | Previous window |
| `Enter` | Open selected window |
| `Esc` | Close quick switcher |

---

## Project Link Configuration

### What are Project Links

Project links allow you to display quick access buttons on window cards for accessing related resources (code repositories, documentation, monitoring dashboards, etc.).

### Configuration Method

Create a `copilot.json` file in the project root directory (terminal working directory):

```json
{
  "version": "1.0",
  "links": [
    {
      "name": "GitHub Repo",
      "url": "https://github.com/your-org/your-repo"
    },
    {
      "name": "Documentation",
      "url": "https://docs.example.com"
    },
    {
      "name": "Monitoring Dashboard",
      "url": "https://grafana.example.com/dashboard"
    }
  ]
}
```

### Field Descriptions

- `version`: Configuration file version, currently `"1.0"`
- `links`: Array of links
  - `name`: Link name (must be globally unique, displayed on button)
  - `url`: Link address (must be a valid URL)

### Usage

1. Create `copilot.json` file
2. Restart window or reload application
3. Link buttons will appear on window card (max 6 displayed)
4. Click button to open link in default browser

---

## Quick Navigation

### What is Quick Navigation

Quick navigation is a global panel for quickly accessing frequently used websites and local folders.

### Open Quick Navigation

- **Method 1**: Double-tap `Ctrl` key
- **Method 2**: Click the compass icon in the main sidebar

### Add Navigation Items

1. Open settings panel (`Ctrl+,`)
2. Switch to "Quick Navigation" tab
3. Click "Add Item"
4. Enter name and URL/path
5. Click "Save"

### Navigation Item Types

- **URL**: Starts with `http://` or `https://`, opens in browser when clicked
- **Folder Path**: Local folder path, opens in file explorer when clicked

### Auto-detection

- System automatically detects input type (URL or folder)
- Automatically extracts name from URL domain or folder path
- Name can be manually edited

---

## Workspace Save and Restore

### Auto-save

- Synapse automatically saves workspace state
- Save interval: 5 seconds (configurable)
- Save location: `%APPDATA%/synapse/workspace.json` (Windows)

### Saved Content

Workspace file contains:
- All window configurations (name, path, status, pane layout)
- All window group configurations (name, layout, window list)
- Current active window/window group
- MRU lists (most recently used windows and groups)
- Sidebar state (expanded/collapsed, width)

### Crash Recovery

- After application crash or abnormal exit, workspace is automatically restored on next startup
- All windows and window groups are restored to pre-crash state
- PTY processes are not automatically started, must be started manually

### Manual Backup

You can manually backup the workspace file:
1. Locate `%APPDATA%/synapse/workspace.json`
2. Copy to a safe location
3. To restore, replace the current `workspace.json` file

---

## FAQ

### Q: Why can't I use a window immediately after creation?

A: Windows are created in paused state by default. You need to click the "Start" button to start the PTY process. This prevents excessive resource consumption on startup.

### Q: How do I enter multi-line commands in the terminal?

A: Use `Ctrl+Enter` or `Shift+Enter` to insert a newline instead of executing the command.

### Q: Quick switcher can't find my window?

A: Make sure the window name or path contains the keywords you entered. Quick switcher supports fuzzy search.

### Q: Project links not showing?

A: Check the following:
1. Is `copilot.json` in the project root directory (terminal working directory)?
2. Is the JSON format correct?
3. Have you restarted the window or reloaded the application?

### Q: Will windows disappear after deleting a window group?

A: No. Deleting a window group only removes the grouping relationship. Windows themselves remain in the window list.

### Q: How do I restore archived windows?

A: In unified view, scroll to the archive area and click the "Restore" button on the window card.

### Q: Status icons not updating?

A: Status detection is based on PTY output analysis with a 500ms update interval. If not updating for a long time, try restarting the window.

### Q: How do I adjust sidebar width?

A: In terminal view, hover the mouse over the right edge of the sidebar. When the resize cursor appears, drag to adjust. Width range: 150-400px.

### Q: Which operating systems are supported?

A:
- Windows 10/11
- macOS 10.15+
- Linux (mainstream distributions)

### Q: How do I change the default shell?

A: You can configure the default shell in the settings panel. On Windows, PowerShell 7+ is preferred, followed by PowerShell 5.1, and finally cmd.exe.

---

## Get Help

- **GitHub Issues**: [Submit an issue](https://github.com/imsuperli/synapse/issues)
- **Documentation**: [Complete Documentation](README.en.md)
- **Developer Guide**: [CLAUDE.md](../CLAUDE.md)

---

**Version**: 3.1.1
**Last Updated**: 2026-03-15
