import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const urlSet = !!process.env.NEXT_PUBLIC_SUPABASE_URL
  const keySet = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const urlValue = process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30)

  const { data, error, count } = await supabase
    .from('products')
    .select('*', { count: 'exact' })

  const { data: activeData, error: activeError } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)

  return NextResponse.json({
    env: { urlSet, keySet, urlPreview: urlValue },
    allProductsQuery: {
      count,
      error: error?.message ?? null,
      rows: data?.length ?? 0,
      sample: data?.slice(0, 2) ?? []
    },
    activeProductsQuery: {
      error: activeError?.message ?? null,
      rows: activeData?.length ?? 0,
      sample: activeData?.slice(0, 2) ?? []
    }
  })
}
