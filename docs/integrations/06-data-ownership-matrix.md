# Integration data ownership matrix

Every piece of data has **one system of record** (the "owner"). Other systems may *read* it, but only the owner may change it. GoldwaterShiftHQ enforces this in code (`src/lib/ownership.ts`): a sync that tries to write a field owned by another system is stopped with an error.

GoldwaterShiftHQ is "SNF Workforce" in this table.

| Data | System of record | Direction | Verified? | Notes / what to confirm |
|---|---|---|---|---|
| Employee identity (name, employee number) | **Paycor** | Paycor → SNF Workforce | ☐ | Confirm employee number is maintained in Paycor and copied into AOD |
| Employment status | **Paycor** | Paycor → SNF Workforce | ☐ | Confirm how leave of absence appears in Paycor |
| Hire / termination status | **Paycor** | Paycor → SNF Workforce | ☐ | |
| Job classification | **Paycor** *(subject to verification)* | Paycor → SNF Workforce | ☐ | Is job/position data in Paycor accurate and current (CNA/LPN/RN)? |
| Home facility | **Paycor** or an approved mapping | Paycor → SNF Workforce | ☐ | Which Paycor field means "facility": work location, department, or legal entity? Is a mapping table needed? |
| Regional pool classification | **SNF Workforce**, linked to Paycor ID | Stays in SNF Workforce | ☐ | Never pushed back to Paycor |
| Budgeted staffing | **SNF Workforce** | | ✓ | |
| Employee schedules | **SNF Workforce** | | ✓ | Does AOD also hold schedules (it has a Scheduling module)? If so, decide which is master. |
| Open shift marketplace | **SNF Workforce** | | ✓ | |
| Shift claims | **SNF Workforce** | | ✓ | |
| Clock punches | **Attendance on Demand** | AOD → SNF Workforce (read-only) | ☐ | The app never edits punches |
| Actual hours worked | **Attendance on Demand** *(subject to verification)* | AOD → SNF Workforce | ☐ | Are approved hours final in AOD, or adjusted in Paycor payroll? |
| Payroll calculations | **Paycor** | Read-only, later | ☐ | The app never submits payroll adjustments |
| Overtime projections | **SNF Workforce** | | ✓ | Confirm FLSA workweek start day (app assumes Sunday) |

## Questions to confirm with HR/payroll (tick the box above when confirmed)

1. Which Paycor field identifies an employee's home facility?
2. Is the Paycor employee number the same as the AOD employee number for everyone?
3. Do hours flow AOD → Paycor today? Through which export?
4. Where are timecard corrections made: in AOD only, or also in Paycor?
5. What day does the overtime workweek start?
6. Does anyone maintain schedules inside AOD today?

## Safety rules built into the app

- AOD employees are used **only for matching**. The app never creates an employee from AOD data. Unmatched people are flagged for a human.
- Paycor sync updates only Paycor-owned fields and preserves SNF Workforce fields (such as regional pool).
- No punch edits and no payroll submissions are possible. That would need a separate, explicitly authorized workflow.
