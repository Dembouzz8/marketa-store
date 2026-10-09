import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")

const productForm = read("src/components/vendor/product-form.tsx")
const productGallery = read("src/components/product-gallery.tsx")
const productCard = read("src/components/product-card.tsx")
const productDetailLoading = read("src/app/(store)/products/[id]/loading.tsx")

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

function appendWithinLimit(current, incoming, limit = 6) {
  if (incoming.length > Math.max(0, limit - current.length)) {
    return { accepted: false, images: current }
  }
  return { accepted: true, images: [...current, ...incoming] }
}

function moveImage(images, fromIndex, toIndex) {
  if (fromIndex === toIndex || toIndex < 0 || toIndex >= images.length) {
    return images
  }
  const next = [...images]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function sanitizeGalleryImages(images) {
  return Array.from(
    new Set(images.map((image) => image.trim()).filter(Boolean))
  ).slice(0, 6)
}

test("product detail contains the full image in a bounded responsive frame", () => {
  const mainFrame = between(
    productGallery,
    '<div className="relative h-[clamp(20rem,75vw,40rem)]',
    "<StockBadge"
  )

  assert.match(mainFrame, /lg:h-\[min\(70vh,40rem\)\]/)
  assert.match(mainFrame, /bg-zinc-100/)
  assert.match(mainFrame, /className="object-contain"/)
  assert.doesNotMatch(mainFrame, /aspect-square/)
  assert.doesNotMatch(mainFrame, /className="object-cover"/)
  assert.match(
    productDetailLoading,
    /h-\[clamp\(20rem,75vw,40rem\)\][^"\n]*lg:h-\[min\(70vh,40rem\)\]/
  )
})

test("catalogue cards retain their square cropped primary-image contract", () => {
  const cardImage = between(
    productCard,
    '<div className="relative aspect-square',
    "{product.category"
  )
  assert.match(cardImage, /src=\{getProductImage\(product\.images\)\}/)
  assert.match(cardImage, /fill/)
  assert.match(cardImage, /className="object-cover"/)
})

test("vendor selection appends within six slots and rejects a seventh before upload", () => {
  assert.match(productForm, /const MAX_PRODUCT_IMAGES = 6/)
  assert.match(
    productForm,
    /const remainingImageSlots = Math\.max\(0, MAX_PRODUCT_IMAGES - imageItems\.length\)/
  )
  assert.match(productForm, /allowedFiles\.length > remainingImageSlots/)
  assert.match(
    productForm,
    /setImageItems\(\(current\) => \[\.\.\.current, \.\.\.newItems\]\)/
  )

  const rejection = productForm.indexOf("allowedFiles.length > remainingImageSlots")
  const previewCreation = productForm.indexOf("URL.createObjectURL(file)")
  const upload = productForm.indexOf("const uploadImages = async")
  const productMutation = productForm.indexOf('.from("products")')
  assert.ok(rejection < previewCreation)
  assert.ok(rejection < upload)
  assert.ok(rejection < productMutation)

  const firstSelection = appendWithinLimit(["a", "b", "c"], ["d", "e", "f"])
  assert.deepEqual(firstSelection, {
    accepted: true,
    images: ["a", "b", "c", "d", "e", "f"],
  })
  assert.deepEqual(appendWithinLimit(firstSelection.images, ["g"]), {
    accepted: false,
    images: firstSelection.images,
  })
})

test("ordered state deterministically controls primary, movement, removal, and persistence", () => {
  assert.match(productForm, /type ProductImageItem =/)
  assert.match(
    productForm,
    /id: `existing-\$\{product\?\.id \?\? "new"\}-\$\{index\}`/
  )
  assert.match(productForm, /id: `new-\$\{crypto\.randomUUID\(\)\}`/)
  assert.match(productForm, /onClick=\{\(\) => moveImage\(index, 0\)\}/)
  assert.match(productForm, /onClick=\{\(\) => moveImage\(index, index - 1\)\}/)
  assert.match(productForm, /onClick=\{\(\) => moveImage\(index, index \+ 1\)\}/)
  assert.match(
    productForm,
    /setImageItems\(\(current\) =>\s*current\.filter\(\(candidate\) => candidate\.id !== id\)/
  )
  assert.match(productForm, /const imageUrls = imageItems\.map/)
  assert.match(productForm, /images: imageUrls/)

  const initial = ["first", "second", "third"]
  assert.deepEqual(moveImage(initial, 2, 0), ["third", "first", "second"])
  assert.deepEqual(moveImage(initial, 1, 0), ["second", "first", "third"])
  assert.deepEqual(moveImage(initial, 1, 2), ["first", "third", "second"])
  assert.deepEqual(initial.filter((image) => image !== "second"), [
    "first",
    "third",
  ])
})

test("existing-image removal is reference-only and preview URLs have bounded lifetimes", () => {
  assert.match(productForm, /URL\.revokeObjectURL\(item\.previewUrl\)/)
  assert.match(productForm, /urls\.forEach\(\(url\) => URL\.revokeObjectURL\(url\)\)/)
  assert.match(productForm, /previewUrls\.current\.delete\(item\.previewUrl\)/)
  assert.doesNotMatch(productForm, /\.storage[\s\S]*?\.remove\(/)
  assert.doesNotMatch(productForm, /\.from\("product-images"\)[\s\S]*?\.remove\(/)
})

test("gallery sanitizes to six ordered images and exposes accessible navigation", () => {
  assert.match(
    productGallery,
    /new Set\(\(images \?\? \[\]\)\.map\(\(image\) => image\.trim\(\)\)\.filter\(Boolean\)\)/
  )
  assert.match(productGallery, /\.slice\(0, 6\)/)
  assert.match(productGallery, /onClick=\{showPreviousImage\}/)
  assert.match(productGallery, /onClick=\{showNextImage\}/)
  assert.match(productGallery, /aria-label="View previous product image"/)
  assert.match(productGallery, /aria-label="View next product image"/)
  assert.match(
    productGallery,
    /onClick=\{\(\) => setSelectedIndex\(index\)\}/
  )
  assert.match(
    productGallery,
    /aria-current=\{selectedIndex === index \? "true" : undefined\}/
  )
  assert.match(productGallery, /focus-visible:ring-2 focus-visible:ring-amber-500/)
  assert.match(productGallery, /overflow-x-auto/)

  assert.deepEqual(
    sanitizeGalleryImages([
      " first ",
      "",
      "second",
      "first",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
    ]),
    ["first", "second", "third", "fourth", "fifth", "sixth"]
  )
})

test("gallery resets selection and broken-image state through a product-keyed remount", () => {
  assert.match(productGallery, /import \{ useMemo, useState \} from "react"/)
  assert.match(
    productGallery,
    /export function ProductGallery\(\{ product \}: \{ product: Product \}\) \{\s*return <ProductGalleryContent key=\{product\.id\} product=\{product\} \/>\s*\}/
  )
  assert.match(
    productGallery,
    /function ProductGalleryContent\(\{ product \}: \{ product: Product \}\) \{[\s\S]*const \[selectedIndex, setSelectedIndex\] = useState\(0\)[\s\S]*const \[brokenImages, setBrokenImages\] = useState<string\[\]>\(\[\]\)/
  )
  assert.doesNotMatch(productGallery, /useEffect/)
})

test("single and empty galleries retain their minimal controls and fallback", () => {
  assert.equal(
    (productGallery.match(/images\.length > 1 &&/g) ?? []).length,
    2
  )
  assert.match(
    productGallery,
    /const selectedIsBroken = !selectedImage \|\| brokenImages\.includes\(selectedImage\)/
  )
  assert.match(productGallery, /<ImageFallback \/>/)
  assert.match(productGallery, /Image unavailable/)
})
