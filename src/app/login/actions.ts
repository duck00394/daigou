"use server";
import { loginWithPassword } from "@/server/auth";

export async function loginAction(password: string) {
  return loginWithPassword(password);
}
