import { z } from "zod";
import { TechStackSchema } from "./layer2-config.schema.js";

export const TaskComplexitySchema = z.enum(["S", "M", "L"]);

export type TaskComplexity = z.infer<typeof TaskComplexitySchema>;

export const DecomposedTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  dependsOn: z.array(z.string().min(1)),
  fileScope: z.array(z.string().min(1)).min(1).max(3),
  estimatedComplexity: TaskComplexitySchema,
});

export type DecomposedTask = z.infer<typeof DecomposedTaskSchema>;

export const DecomposedTaskListSchema = z
  .object({
    tasks: z.array(DecomposedTaskSchema).min(3).max(15),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (let index = 0; index < value.tasks.length; index += 1) {
      const task = value.tasks[index];
      if (ids.has(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tasks", index, "id"],
          message: `duplicate task id: ${task.id}`,
        });
      }
      ids.add(task.id);
    }

    for (let index = 0; index < value.tasks.length; index += 1) {
      const task = value.tasks[index];
      for (const dependencyId of task.dependsOn) {
        if (!ids.has(dependencyId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tasks", index, "dependsOn"],
            message: `unknown dependency id: ${dependencyId}`,
          });
        }
      }
    }
  });

export type DecomposedTaskList = z.infer<typeof DecomposedTaskListSchema>;

export const TaskDecomposeInputSchema = z.object({
  projectBrief: z.string().min(1),
  techStack: TechStackSchema,
  constraints: z.array(z.string().min(1)).optional(),
});

export type TaskDecomposeInput = z.infer<typeof TaskDecomposeInputSchema>;
