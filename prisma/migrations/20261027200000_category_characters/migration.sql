-- CreateTable
CREATE TABLE "CategoryCharacter" (
    "categoryId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryCharacter_pkey" PRIMARY KEY ("categoryId","characterId")
);

-- CreateIndex
CREATE INDEX "CategoryCharacter_characterId_idx" ON "CategoryCharacter"("characterId");

-- AddForeignKey
ALTER TABLE "CategoryCharacter" ADD CONSTRAINT "CategoryCharacter_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryCharacter" ADD CONSTRAINT "CategoryCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

