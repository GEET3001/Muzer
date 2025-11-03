-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('Streamer', 'EndUser');

-- CreateEnum
CREATE TYPE "public"."Provider" AS ENUM ('Google');

-- CreateEnum
CREATE TYPE "public"."StreamType" AS ENUM ('Spotify', 'Youtube');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider" "public"."Provider" NOT NULL,
    "role" "public"."Role" NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Stream" (
    "id" TEXT NOT NULL,
    "type" "public"."StreamType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Upvotes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,

    CONSTRAINT "Upvotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Upvotes_userId_streamId_key" ON "public"."Upvotes"("userId", "streamId");

-- AddForeignKey
ALTER TABLE "public"."Stream" ADD CONSTRAINT "Stream_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upvotes" ADD CONSTRAINT "Upvotes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upvotes" ADD CONSTRAINT "Upvotes_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "public"."Stream"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
