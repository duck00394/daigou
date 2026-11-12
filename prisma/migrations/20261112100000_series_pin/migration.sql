-- CreateTable
CREATE TABLE "SeriesPin" (
    "operatorId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeriesPin_pkey" PRIMARY KEY ("operatorId","categoryId")
);

-- CreateIndex
CREATE INDEX "SeriesPin_operatorId_rank_idx" ON "SeriesPin"("operatorId", "rank");

-- AddForeignKey
ALTER TABLE "SeriesPin" ADD CONSTRAINT "SeriesPin_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesPin" ADD CONSTRAINT "SeriesPin_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

