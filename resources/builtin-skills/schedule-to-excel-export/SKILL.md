---
name: schedule-to-excel-export
description: 
enabled: true
---

# Schedule to Excel Export Skill

This skill defines the process and design specifications for exporting a project schedule/plan into a professional Excel (.xlsx) workbook.

## Usage Contexts

### 1. When invoked via User Chat
If the user requests to export a schedule to Excel:
- Call the `xlsx` module.
- In the prompt to the `xlsx` module, explicitly instruct it to follow the design specifications defined in this skill: [Schedule to Excel Export Skill](skill:schedule-to-excel-export).
- Provide the reference to the plan using `plan:<schedule id or name>`.

### 2. When invoked by the `xlsx` Module
The `xlsx` module must adhere to the following design and layout specifications to ensure consistency.

## Design Specifications

**General Settings:**
- **Main Font:** Calibri
- **Font Size:** 11

### Section 0: Project Title (Top of Sheet)
- **C2** = `Project Name:` (label; Font must be **Bold**)
- **C3** = `<project name>` (the actual name of the exported project/schedule)

### Section 1: Header
- **Start Position:** Cell B5
- **Styling:**
    - **Background Color:** Very Dark Blue
    - **Font Color:** White
    - **Borders:** Light Gray on all 4 sides
- **Columns (Left to Right):**
    1. ITEM (Map to: task no)
    2. TASK (Map to: task title)
    3. STATUS (Map to: status)
    4. OWNER (Map to: owner)
    5. DUR (Map to: duration)
    6. START (Map to: plan start)
    7. END (Map to: plan end)
    8. Act. Start (Map to: actual start)
    9. Act. End (Map to: actual end)
    10. Status in % (Map to: %complete)

### Section 2: Body
- **Start Position:** Row 6 (starting from B6), following the header order.
- **General Styling:** 
    - All cells must have Light Gray borders on all 4 sides.
- **Task Title Indentation:**
    - Task titles in the TASK column must be indented **4 spaces per hierarchy level** (e.g., level 1 = no indent, level 2 = 4 spaces, level 3 = 8 spaces, ...).
- **Task Hierarchy Styling (applies to the ENTIRE ROW, i.e. all 10 cells from ITEM to Status in %):**
    - **Tasks with Children:** Font must be **Bold** on the **entire row** (not just the TASK cell).
    - **Root Tasks with Children:** Background color must be Light Blue AND font must be **Bold** on the **entire row** (all cells), not just the TASK cell.
    - Note: The STATUS cell's conditional background (Light Yellow / Light Green / Light Red) still takes precedence for that single cell over the row background.

### Column Details & Formatting

| Column | Alignment | Width | Conditional Formatting / Notes |
| :--- | :--- | :--- | :--- |
| **ITEM** | Right | 5.83 | |
| **TASK** | Left | 60.82 | Indent 4 spaces per hierarchy level |
| **STATUS** | Center | 10.00 | Value options: 'Not Started', 'In Progress', 'Completed', 'Pending', 'On Hold'<br>- 'In Progress' -> Light Yellow background<br>- 'Completed' -> Light Green background<br>- 'Pending' or 'On Hold' -> Light Red background |
| **OWNER** | Center | 17.50 | |
| **DUR** | Center | 5.33 | |
| **Dates & %** | Center | 12.67 | Applies to START, END, Act. Start, Act. End, and Status in % |
