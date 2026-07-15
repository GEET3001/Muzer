-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_streamId_fkey";

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "streamId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;
