---
name: schedule-to-excel-update
description: Updates an existing Excel (.xlsx) workbook in-place from a project schedule, keeping the workbook's own column structure while applying the standard status background colors and % complete rules.
enabled: true
---

# Schedule to Excel Update Skill

This skill defines the process and specifications for updating an **existing** Excel (.xlsx) workbook in-place with the latest data from a project schedule/plan. Unlike the export skill, the column structure is taken from the existing workbook — only the data, status colors, and % complete values are (re)applied.

## Usage Contexts

### 1. When invoked via User Chat

If the user requests to update an Excel file from a schedule:

- Identify the existing .xlsx file in the project files folder that should be updated (if multiple .xlsx files exist, ask the user which one is the target).
- Call the `xlsx` module in **edit existing workbook** mode.
- In the prompt to the `xlsx` module, explicitly instruct it to follow the update specifications defined in this skill: [Schedule to Excel Update Skill](skill:schedule-to-excel-update).
- Provide the reference to the plan using `plan:<schedule id or name>`.
- Provide the target workbook as `file:<filename.xlsx>`.

### 2. When invoked by the `xlsx` Module

The `xlsx` module must adhere to the following update specifications to ensure consistency.

## Update Specifications

### Step 1: Inspect the Existing Workbook (Column Structure)

- Read the existing workbook **first** and determine its actual column structure: header row position, header names, column order, and the start position of the data rows.
- Map the schedule fields to the **existing** columns by header name (case-insensitive), e.g.:
  - ITEM -> task no
  - TASK -> task title
  - STATUS -> status
  - OWNER -> owner
  - DUR -> duration
  - START -> plan start
  - END -> plan end
  - Act. Start -> actual start
  - Act. End -> actual end
  - Status in % -> %complete
- **Do NOT change** the existing column layout, header row, column widths, or header styling. Only update the data rows.
- If a column exists in the workbook but has no matching schedule field, leave it untouched.

### Step 2: Update the Data Rows

- Replace the existing task rows with the current schedule task tree (all tasks, in the same outline order as the schedule).
- If the schedule has more or fewer tasks, add or remove data rows as needed.
- Preserve the general cell styling (font, borders) of the data area.
- **Task Title Indentation:** Task titles in the TASK column must be indented **4 spaces per hierarchy level** (e.g., level 1 = no indent, level 2 = 4 spaces, level 3 = 8 spaces, ...).
- **Task Hierarchy Styling (applies to the ENTIRE ROW, i.e. all data cells of the row):**
  - **Tasks with Children:** Font must be **Bold** on the entire row (not just the TASK cell).
  - **Root Tasks with Children:** Background color must be Light Blue AND font must be **Bold** on the entire row (all cells), not just the TASK cell.

### Step 2: Update the Data Rows

- Replace the existing task rows with the current schedule task tree (all tasks, in the same outline order as the schedule).
- If the schedule has more or fewer tasks, add or remove data rows as needed.
- Preserve the general cell styling (font, borders) of the data area.
- **Task Title Indentation:** Task titles in the TASK column must be indented **2 spaces per hierarchy level** (e.g., level 1 = no indent, level 2 = 2 spaces, level 3 = 4 spaces, ...).
- **Task Hierarchy Styling (applies to the ENTIRE ROW, i.e. all data cells of the row):**
  - **Tasks with Children:** Font must be **Bold** on the entire row (not just the TASK cell).
  - **Root Tasks with Children:** Background color must be Light Blue AND font must be **Bold** on the entire row (all cells), not just the TASK cell.

### Step 3: STATUS Cell Background Colors

Apply the following conditional background to the **single STATUS cell only**:

- 'In Progress' -> **Light Yellow** background
- 'Completed' -> **Light Green** background
- 'Pending' or 'On Hold' -> **Light Red** background
- 'Not Started' -> no background (default cell fill)

### Step 4: % Complete (Status in %)

- The % complete value must be written as a **decimal between 0 and 1** (e.g., 18% is written as `0.18`, 100% as `1`), with a percentage number format so it displays as 18% / 100%.
- This same principle applies on every update, regardless of the column's position in the workbook.
