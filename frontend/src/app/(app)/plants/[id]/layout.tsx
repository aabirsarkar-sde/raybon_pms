import { notFound } from "next/navigation"

import { PlantFrame } from "@/components/plant/plant-frame"

export default async function PlantLayout({ children, params }: LayoutProps<"/plants/[id]">) {
  const { id } = await params
  if (!/^\d{1,12}$/.test(id)) notFound()
  return <PlantFrame id={Number(id)}>{children}</PlantFrame>
}
