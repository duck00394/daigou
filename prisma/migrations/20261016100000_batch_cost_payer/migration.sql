-- AlterEnum
ALTER TYPE "AllocationMethod" ADD VALUE 'NONE';

-- AlterTable
ALTER TABLE "BatchCost" ADD COLUMN     "payer" TEXT,
ADD COLUMN     "shareSplit" JSONB;

