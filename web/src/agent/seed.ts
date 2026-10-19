import peopleJson from "../../../seed/people.json";
import requestsJson from "../../../seed/requests.json";
import type { ExpenseDeskState, ExpenseRequest, PersonRef } from "./contract";

type SeedEmployee = (typeof peopleJson.employees)[number];

export const directory: Record<string, SeedEmployee> = Object.fromEntries(
  peopleJson.employees.map((e) => [e.id, e]),
);

export const financeUser = peopleJson.finance;

export function personRef(id: string): PersonRef {
  const e = directory[id];
  return { id: e.id, name: e.name, title: e.title, department: e.department };
}

export function findEmployeeByName(name: string) {
  return peopleJson.employees.find((e) => e.name.toLowerCase() === name.toLowerCase());
}

/** Initial shared state: the seeded history, with people resolved. */
export function seedDeskState(): ExpenseDeskState {
  const requests = (requestsJson.requests as ExpenseRequest[]).map((r) => ({
    ...r,
    employee: r.employeeId ? personRef(r.employeeId) : undefined,
    manager: r.managerId ? personRef(r.managerId) : undefined,
  }));
  const people: Record<string, PersonRef> = Object.fromEntries(peopleJson.employees.map((e) => [e.id, personRef(e.id)]));
  people[financeUser.id] = { id: financeUser.id, name: financeUser.name, title: financeUser.title, department: "Finance" };
  return { requests, learnedRules: [], people, activeRequestId: null };
}
