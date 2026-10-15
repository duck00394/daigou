-- CreateEnum
CREATE TYPE "BatchOwnership" AS ENUM ('PERSONAL', 'JOINT');

-- CreateEnum
CREATE TYPE "BatchProgress" AS ENUM ('ASKED', 'AGENT_HAS', 'SHIPPED');

-- AlterTable
ALTER TABLE "PurchaseBatch" ADD COLUMN     "ownership" "BatchOwnership" NOT NULL DEFAULT 'PERSONAL',
ADD COLUMN     "progress" "BatchProgress" NOT NULL DEFAULT 'ASKED';

