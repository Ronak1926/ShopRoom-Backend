/**
 * prisma/notificationTemplates.ts — The CounterCircle starter template catalog.
 *
 * SCOPE: a template is the notification's BIG-PICTURE IMAGE — nothing else.
 * Android/iOS draw the app icon, app name, timestamp, title and body text
 * themselves, so the canvas is only the 2:1 banner (400×200) below them.
 *
 * Every template is a PRODUCT banner: a local shop showing its own products
 * with a real photo, the product name, the price and an offer. The layouts
 * live in prisma/templates/layouts.ts; this file gives each one content for a
 * different kind of shop (grocery, dairy, fashion, footwear, jewellery,
 * electronics, home, bakery, café, restaurant, beauty, stationery, plants).
 * Shop names are made up. The first IMAGE in each design is the product
 * photo, which is also what the phone tray shows when the app is closed.
 */

import {
  NotificationDesignSchema,
  type NotificationType,
} from "../src/schemas/notification.schema.js";
import { INK, WHITE, BRAND, type Design } from "./templates/kit.js";
import * as L from "./templates/layouts.js";

const CATEGORY_TYPES: Record<string, NotificationType> = {
  "new-arrival": "NEW_ARRIVAL",
  "new-stock": "NEW_STOCK",
  restock: "RESTOCK",
  "limited-stock": "LIMITED_STOCK",
  sale: "SALE",
  "flash-sale": "FLASH_SALE",
  offer: "OFFER",
  event: "EVENT",
  announcement: "ANNOUNCEMENT",
  reminder: "REMINDER",
  custom: "CUSTOM",
};

interface Entry {
  slug: string;
  name: string;
  categorySlug: keyof typeof CATEGORY_TYPES;
  design: () => Design;
}

const t = (slug: string, name: string, categorySlug: Entry["categorySlug"], design: () => Design): Entry => ({ slug, name, categorySlug, design });

const CATALOG: Entry[] = [
  // ── Hero product ───────────────────────────────────────────────────────────
  t("product-hero", "Hero Product", "new-arrival", () => L.hero({ shop: "Riya Boutique", label: "New in store", name: "Banarasi Silk Saree", price: "₹4,299", mrp: "₹6,499", cta: "View in shop", photo: "saree", tint: "#3A0A12" })),
  t("hero-wrap-dress", "Hero · Dress", "new-arrival", () => L.hero({ shop: "Lavender Lane", label: "Festive drop", name: "Floral Wrap Dress", price: "₹1,650", mrp: "₹2,199", cta: "Try it in store", photo: "redDress2", tint: "#3B0A0A", position: "center" })),
  t("hero-biryani", "Hero · Biryani", "offer", () => L.hero({ shop: "Masala House", label: "Chef's special", name: "Hyderabadi Dum Biryani", price: "₹249", cta: "Order now", photo: "biryani", tint: "#2A1206", position: "center" })),
  t("hero-sofa", "Hero · Sofa", "new-stock", () => L.hero({ shop: "Home Nest", label: "New in showroom", name: "Velvet 3-Seater Sofa", price: "₹24,999", mrp: "₹31,999", cta: "Book a visit", photo: "sofa", tint: "#0D2B25", position: "center" })),

  // ── Price sticker ──────────────────────────────────────────────────────────
  t("product-price-sticker", "Price Sticker", "offer", () => L.sticker({ shop: "SoundHub", label: "Wireless · 30h battery", name: "Studio Headphones", stickerLabel: "only", price: "₹1,299", cta: "Buy now", photo: "headphones", bg: "#F7C518" })),
  t("sticker-ice-cream", "Sticker · Ice Cream", "offer", () => L.sticker({ shop: "Cream Corner", label: "Summer special", name: "Vanilla Swirl Cone", stickerLabel: "just", price: "₹60", cta: "Grab one", photo: "iceCream", bg: "#F9B54C" })),
  t("sticker-headphones", "Sticker · Headphones", "offer", () => L.sticker({ shop: "Tech Bazaar", label: "Up to 40h playtime", name: "Over-Ear Headphones", stickerLabel: "now", price: "₹2,499", cta: "Buy now", photo: "headphones3", bg: "#ECECEC" })),
  t("sticker-cupcakes", "Sticker · Cupcakes", "offer", () => L.sticker({ shop: "Bake Studio", label: "Fresh every morning", name: "Strawberry Cupcakes", stickerLabel: "box of 6", price: "₹299", cta: "Pre-order", photo: "cupcakes", bg: "#F6D9DE" })),

  // ── Split card ─────────────────────────────────────────────────────────────
  t("product-split-card", "Split Card", "offer", () => L.split({ shop: "Gadget Point", discount: "25% OFF", name: "Smart Watch S2", spec: "AMOLED · 7-day battery", price: "₹2,999", mrp: "₹3,999", cta: "Order now", photo: "smartwatch", accent: BRAND })),
  t("split-laptop", "Split · Laptop", "offer", () => L.split({ shop: "Tech Bazaar", discount: "15% OFF", name: "Slim Laptop 14 inch", spec: "16 GB RAM · 512 GB SSD", price: "₹54,990", mrp: "₹64,990", cta: "Book a demo", photo: "laptop", accent: "#2563EB" })),
  t("split-sunglasses", "Split · Sunglasses", "sale", () => L.split({ shop: "Specs & More", discount: "30% OFF", name: "Round Sunglasses", spec: "UV400 · metal frame", price: "₹899", mrp: "₹1,299", cta: "Try them on", photo: "sunglasses", accent: "#0F766E" })),
  t("split-blender", "Split · Blender", "offer", () => L.split({ shop: "Home Nest", discount: "20% OFF", name: "Power Blender", spec: "1.5 L glass jar · 3 speeds", price: "₹2,199", mrp: "₹2,749", cta: "Order now", photo: "blender", accent: "#EA580C" })),

  // ── Discount burst ─────────────────────────────────────────────────────────
  t("product-discount-burst", "Discount Burst", "sale", () => L.burst({ shop: "Step Up Shoes", discount: "40%", name: "Suede Loafers", price: "₹1,799", mrp: "₹2,999", photo: "loafers", bg: "#F3E5DD", burst: "#E11D48" })),
  t("burst-heels", "Burst · Heels", "sale", () => L.burst({ shop: "Stiletto Lane", discount: "40%", name: "Printed Heels", price: "₹1,499", mrp: "₹2,499", photo: "heels", bg: "#8ED1E8", burst: "#DB2777" })),
  t("burst-handbag", "Burst · Handbag", "sale", () => L.burst({ shop: "Bag Story", discount: "30%", name: "Leather Handbag", price: "₹2,299", mrp: "₹3,299", photo: "redBag", bg: "#5A1A14", burst: "#F59E0B" })),
  t("burst-chair", "Burst · Chair", "sale", () => L.burst({ shop: "Home Nest", discount: "35%", name: "Accent Chair", price: "₹6,499", mrp: "₹9,999", photo: "chair", bg: "#E5E7E4", burst: "#0F766E" })),

  // ── Two products ───────────────────────────────────────────────────────────
  t("product-pair", "Two Products", "new-stock", () => L.pair({ label: "Cotton Co.", title: "Everyday basics", cta: "See sizes", items: [{ photo: "tee", name: "Cotton Tee", price: "₹399" }, { photo: "sweatshirt", name: "Sweatshirt", price: "₹899" }], bg: "#F4EFE6", ink: "#2B2118" })),
  t("pair-bags", "Two · Bags", "new-stock", () => L.pair({ label: "Bag Story", title: "Carry-all bags", cta: "Visit store", items: [{ photo: "orangeBag", name: "Wicker Tote", price: "₹1,299" }, { photo: "tealBag", name: "Satchel", price: "₹1,899" }], bg: "#FBF3EA", ink: "#3B2414" })),
  t("pair-plants", "Two · Plants", "new-stock", () => L.pair({ label: "Green Pot Nursery", title: "Desk plants", cta: "Pick yours", items: [{ photo: "succulent", name: "Succulent", price: "₹199" }, { photo: "cactus", name: "Cactus", price: "₹149" }], bg: "#EEF5EC", ink: "#1F3B2C" })),
  t("pair-bread", "Two · Bread", "new-stock", () => L.pair({ label: "Bake Studio", title: "Fresh from the oven", cta: "Reserve a loaf", items: [{ photo: "breadLoaves", name: "Multigrain", price: "₹90" }, { photo: "slicedBread", name: "Sourdough", price: "₹120" }], bg: "#F7EFE3", ink: "#3B2A1A" })),

  // ── Three-product grid ─────────────────────────────────────────────────────
  t("product-grid", "Three Products", "new-arrival", () => L.grid({ title: "New this week", link: "See all →", items: [{ photo: "shirts", name: "Linen Shirt", price: "₹799" }, { photo: "backpack", name: "Daypack", price: "₹1,199" }, { photo: "sneaker", name: "Runner", price: "₹1,899" }], bg: "#0F172A", linkColor: "#A5B4FC" })),
  t("grid-bakery", "Grid · Bakery", "new-stock", () => L.grid({ title: "Today's bakes", link: "Order →", items: [{ photo: "cookies", name: "Choco Cookies", price: "₹149" }, { photo: "donuts", name: "Glazed Donuts", price: "₹60" }, { photo: "cakeSlice", name: "Berry Cake", price: "₹120" }], bg: "#2A1810", linkColor: "#FBBF24" })),
  t("grid-jewellery", "Grid · Jewellery", "new-arrival", () => L.grid({ title: "Bridal edit", link: "Visit store →", items: [{ photo: "necklace", name: "Gold Pendant", price: "₹18,500" }, { photo: "earrings", name: "Drop Earrings", price: "₹6,200" }, { photo: "ring", name: "Solitaire Ring", price: "₹24,000" }], bg: "#1A1407", linkColor: "#F5D27A" })),
  t("grid-gadgets", "Grid · Gadgets", "new-arrival", () => L.grid({ title: "Top gadgets", link: "See all →", items: [{ photo: "headphones2", name: "Headphones", price: "₹1,799" }, { photo: "speaker", name: "Bookshelf Speaker", price: "₹3,499" }, { photo: "mouse", name: "Wireless Mouse", price: "₹699" }], bg: "#0B1B2B", linkColor: "#7DD3FC" })),

  // ── Daily rate card ────────────────────────────────────────────────────────
  t("product-rate-card", "Daily Rate Card", "new-stock", () => L.rateCard({ label: "Today's rates · 7 AM", name: "Sharma Sabzi", rows: [["Tomato", "₹40", "/kg"], ["Onion", "₹35", "/kg"], ["Potato", "₹30", "/kg"], ["Spinach", "₹20", "/bunch"]], tag: "Fresh stock", photo: "vegetables", bg: "#0F3D2E", accent: "#BEF264" })),
  t("rate-fruits", "Rates · Fruits", "new-stock", () => L.rateCard({ label: "Today's rates · 8 AM", name: "Fruit Mandi", rows: [["Banana", "₹50", "/dozen"], ["Apple", "₹160", "/kg"], ["Papaya", "₹45", "/kg"], ["Grapes", "₹90", "/kg"]], tag: "Just arrived", photo: "fruitBowl", bg: "#3B0D1F", accent: "#FCD34D" })),
  t("rate-dairy", "Rates · Dairy", "new-stock", () => L.rateCard({ label: "Today's prices", name: "Daily Dairy", rows: [["Milk", "₹62", "/litre"], ["Curd", "₹30", "/500g"], ["Paneer", "₹90", "/200g"], ["Ghee", "₹320", "/500ml"]], tag: "Fresh today", photo: "milkPour", bg: "#0B2545", accent: "#7DD3FC" })),
  t("rate-kirana", "Rates · Kirana", "new-stock", () => L.rateCard({ label: "This week's rates", name: "Patel Kirana", rows: [["Basmati", "₹110", "/kg"], ["Toor dal", "₹140", "/kg"], ["Sugar", "₹44", "/kg"], ["Atta", "₹38", "/kg"]], tag: "Home delivery", photo: "rice", bg: "#3A2A05", accent: "#FDE68A" })),

  // ── Combo deal ─────────────────────────────────────────────────────────────
  t("product-combo", "Combo Deal", "offer", () => L.combo({ label: "Urban Store · Combo deal", photos: ["sneaker", "backpack"], comboName: "Runner + Daypack", priceLabel: "Both for", price: "₹2,499", saving: "Save ₹600", cta: "Grab the combo", from: "#7C3AED", to: "#3B0764", soft: "#E9D5FF" })),
  t("combo-burger-meal", "Combo · Burger Meal", "offer", () => L.combo({ label: "Grill Street · Meal deal", photos: ["burger", "mojito"], comboName: "Burger + Mojito", priceLabel: "Both for", price: "₹249", saving: "Save ₹80", cta: "Order the meal", from: "#F97316", to: "#9A3412", soft: "#FFEDD5" })),
  t("combo-chai", "Combo · Chai", "offer", () => L.combo({ label: "Chai Adda · Evening combo", photos: ["chai", "cookies"], comboName: "Chai + Cookies", priceLabel: "Both for", price: "₹79", saving: "Save ₹21", cta: "Order now", from: "#B45309", to: "#451A03", soft: "#FDE68A" })),
  t("combo-skincare", "Combo · Skincare", "offer", () => L.combo({ label: "Glow Beauty · Combo deal", photos: ["serum", "makeup"], comboName: "Serum + Makeup Kit", priceLabel: "Both for", price: "₹1,499", saving: "Save ₹400", cta: "Get the combo", from: "#DB2777", to: "#831843", soft: "#FCE7F3" })),

  // ── New arrival ────────────────────────────────────────────────────────────
  t("product-new-arrival", "New Arrival", "new-arrival", () => L.newArrival({ shop: "Riya Boutique", ribbon: "NEW", name: "Chikankari Anarkali", colors: ["#E8EFE9", "#F4C2C2", "#C7D2FE"], sizes: ["S", "M", "L", "XL"], price: "₹2,450", photo: "anarkali", tint: "#1C2A24", ribbonColor: "#F43F5E" })),
  t("new-summer-dress", "New · Summer Dress", "new-arrival", () => L.newArrival({ shop: "Lavender Lane", ribbon: "NEW", name: "Cotton Summer Dress", colors: ["#FFFFFF", "#BAE6FD", "#FED7AA"], sizes: ["S", "M", "L"], price: "₹1,850", photo: "whiteDress", tint: "#1F2937", ribbonColor: "#F43F5E", position: "center" })),
  t("new-hoodie", "New · Hoodie", "new-arrival", () => L.newArrival({ shop: "Denim Den", ribbon: "NEW", name: "Fleece Hoodie", colors: ["#9CA3AF", "#111827", "#4D7C0F"], sizes: ["S", "M", "L", "XL", "XXL"], price: "₹1,299", photo: "hoodie", tint: "#1E293B", ribbonColor: "#0EA5E9", position: "center" })),
  t("new-maxi-dress", "New · Maxi Dress", "new-arrival", () => L.newArrival({ shop: "Lavender Lane", ribbon: "NEW", name: "Flowing Maxi Dress", colors: ["#DC2626", "#111827", "#F5F5F4"], sizes: ["XS", "S", "M", "L", "XL"], price: "₹1,899", photo: "redDress", tint: "#14200F", ribbonColor: "#F59E0B", position: "center" })),

  // ── Low stock ──────────────────────────────────────────────────────────────
  t("product-low-stock", "Low Stock", "limited-stock", () => L.lowStock({ shop: "Time House", label: "Almost gone", name: "Classic White Watch", stock: "Only 4 left in store", left: 0.2, price: "₹3,499", cta: "Reserve now", photo: "watches", bg: "#F1F1EF" })),
  t("low-leather-watch", "Low Stock · Watch", "limited-stock", () => L.lowStock({ shop: "Classic Watches", label: "Selling fast", name: "Leather Strap Watch", stock: "Only 3 left in store", left: 0.15, price: "₹2,799", cta: "Hold one", photo: "wristWatch", bg: "#EEF0F2" })),
  t("low-keyboard", "Low Stock · Keyboard", "limited-stock", () => L.lowStock({ shop: "Tech Bazaar", label: "Almost gone", name: "Wireless Keyboard", stock: "Only 5 left this week", left: 0.25, price: "₹1,299", cta: "Reserve now", photo: "keyboard", bg: "#F3F4F6" })),
  t("low-pearls", "Low Stock · Pearls", "limited-stock", () => L.lowStock({ shop: "Gold Leaf Jewellers", label: "Last few pieces", name: "Pearl Necklace Set", stock: "Only 2 sets left", left: 0.12, price: "₹4,999", cta: "Reserve now", photo: "pearls", bg: "#F5F0EB" })),

  // ── Back in stock ──────────────────────────────────────────────────────────
  t("product-back-in-stock", "Back in Stock", "restock", () => L.backInStock({ shop: "Glow Beauty", label: "Restocked today", name: "Rose Glow Makeup Kit", price: "₹1,150", cta: "Order before it's gone", stamp: "BACK IN STOCK", photo: "makeup", tint: "#FAE8D6", ink: "#3B1D1D", stampColor: "#BE123C" })),
  t("back-mangoes", "Back · Mangoes", "restock", () => L.backInStock({ shop: "Fresh Fruits Corner", label: "Season's first batch", name: "Alphonso Mangoes", price: "₹599/dozen", cta: "Order a box", stamp: "BACK IN SEASON", photo: "mangoes", tint: "#FFF3D6", ink: "#4A2A00", stampColor: "#C2410C" })),
  t("back-bomber", "Back · Jacket", "restock", () => L.backInStock({ shop: "Denim Den", label: "Restocked today", name: "Rust Bomber Jacket", price: "₹2,199", cta: "Grab your size", stamp: "BACK IN STOCK", photo: "bomber", tint: "#F1ECE6", ink: "#2A1A12", stampColor: "#B91C1C" })),
  t("back-vitamins", "Back · Pharmacy", "restock", () => L.backInStock({ shop: "Care Plus Pharmacy", label: "Restocked today", name: "Vitamin C Tablets", price: "₹180/strip", cta: "Reserve a pack", stamp: "IN STOCK NOW", photo: "medicine", tint: "#E6F2FB", ink: "#0C2D48", stampColor: "#0369A1" })),

  // ── Deal of the day ────────────────────────────────────────────────────────
  t("product-deal-of-the-day", "Deal of the Day", "flash-sale", () => L.dealOfDay({ label: "Deal of the day", name: "Sweet Watermelon", price: "₹25/kg", mrp: "₹40", ends: "Ends tonight at 11:59 PM", photo: "watermelon", bg: "#FBFBF8", accent: "#E11D48", position: "left" })),
  t("deal-pineapple", "Deal · Pineapple", "flash-sale", () => L.dealOfDay({ label: "Today only", name: "Juicy Pineapple", price: "₹45/pc", mrp: "₹70", ends: "Ends tonight at 9:00 PM", photo: "pineapple", bg: "#FFFFFF", accent: "#16A34A" })),
  t("deal-cherries", "Deal · Cherries", "flash-sale", () => L.dealOfDay({ label: "Deal of the day", name: "Fresh Cherries", price: "₹299", mrp: "₹399", ends: "Today only · till 8 PM", photo: "cherries", bg: "#F3FBF9", accent: "#DC2626" })),
  t("deal-mouse", "Deal · Mouse", "flash-sale", () => L.dealOfDay({ label: "Lightning deal", name: "Wireless Mouse", price: "₹499", mrp: "₹899", ends: "Deal ends at midnight", photo: "mouse", bg: "#FFFFFF", accent: "#2563EB" })),

  // ── Bestseller ─────────────────────────────────────────────────────────────
  t("product-bestseller", "Bestseller", "custom", () => L.bestseller({ shop: "Sweet Tooth Bakery", badge: "#1 Bestseller", name: "Chocolate Truffle Cake", rating: "4.9 · 500+ sold", price: "₹549", unit: "/ 500g", cta: "Pre-order", photo: "cake", tint: "#1C0E06" })),
  t("best-biryani", "Bestseller · Biryani", "custom", () => L.bestseller({ shop: "Masala House", badge: "#1 Bestseller", name: "Chicken Dum Biryani", rating: "4.8 · 2,000+ orders", price: "₹229", unit: "/ plate", cta: "Order now", photo: "biryani", tint: "#1A0D05" })),
  t("best-pizza", "Bestseller · Pizza", "custom", () => L.bestseller({ shop: "Slice Point", badge: "Most ordered", name: "Chef's Special Pizza", rating: "4.7 · 900+ sold", price: "₹349", unit: "/ medium", cta: "Order now", photo: "pizza2", tint: "#140A05" })),
  t("best-latte", "Bestseller · Latte", "custom", () => L.bestseller({ shop: "Brew Bean Café", badge: "Café favourite", name: "Hazelnut Latte", rating: "4.9 · 1,200+ cups", price: "₹160", unit: "/ cup", cta: "Order now", photo: "latte", tint: "#1C120C" })),

  // ── Collection strip ───────────────────────────────────────────────────────
  t("product-collection", "Collection Strip", "new-arrival", () => L.collection({ label: "Riya Boutique", name: "Festive Collection", info: "12 new pieces · from ₹399", cta: "Browse all", items: [{ photo: "saree", name: "Saree", price: "₹4,299" }, { photo: "anarkali", name: "Anarkali", price: "₹2,450" }, { photo: "shirts", name: "Shirt", price: "₹799" }, { photo: "sweatshirt", name: "Sweatshirt", price: "₹899" }], bg: "#111111" })),
  t("collection-jewellery", "Collection · Jewellery", "new-arrival", () => L.collection({ label: "Gold Leaf", name: "Wedding Edit", info: "40 designs · from ₹2,999", cta: "Visit store", items: [{ photo: "necklace", name: "Pendant", price: "₹8,500" }, { photo: "earrings", name: "Earrings", price: "₹6,200" }, { photo: "bracelet", name: "Bracelet", price: "₹9,800" }, { photo: "ring", name: "Ring", price: "₹4,999" }], bg: "#120E06" })),
  t("collection-dresses", "Collection · Dresses", "new-arrival", () => L.collection({ label: "Lavender Lane", name: "Summer Dresses", info: "18 styles · from ₹899", cta: "Browse all", items: [{ photo: "redDress", name: "Maxi", price: "₹1,899" }, { photo: "redDress2", name: "Wrap", price: "₹1,650" }, { photo: "whiteDress", name: "Sundress", price: "₹1,850" }, { photo: "knitTop", name: "Knit", price: "₹999" }], bg: "#2A0A12" })),
  t("collection-home", "Collection · Home", "new-arrival", () => L.collection({ label: "Home Nest", name: "Home Picks", info: "New décor · from ₹149", cta: "Visit store", items: [{ photo: "chair", name: "Chair", price: "₹6,499" }, { photo: "wallDecor", name: "Frames", price: "₹1,299" }, { photo: "succulent", name: "Planter", price: "₹199" }, { photo: "cactus", name: "Cactus", price: "₹149" }], bg: "#13261F" })),

  // ── Quantity prices ────────────────────────────────────────────────────────
  t("product-quantity-prices", "Quantity Prices", "offer", () => L.quantity({ shop: "Fresh Fruits Corner", name: "Kashmiri Apples", label: "Buy more, pay less", tiers: [["1 kg", "₹180"], ["3 kg", "₹500"], ["5 kg", "₹800"]], best: 1, photo: "apples", tint: "#3C0808", accent: "#7F1D1D" })),
  t("qty-eggs", "Quantity · Eggs", "offer", () => L.quantity({ shop: "Daily Dairy", name: "Farm Fresh Eggs", label: "Buy more, pay less", tiers: [["6 eggs", "₹45"], ["12 eggs", "₹84"], ["30 eggs", "₹195"]], best: 2, photo: "eggs", tint: "#2B1A0A", accent: "#9A3412" })),
  t("qty-rice", "Quantity · Rice", "offer", () => L.quantity({ shop: "Patel Kirana", name: "Basmati Rice", label: "Stock up and save", tiers: [["1 kg", "₹110"], ["5 kg", "₹520"], ["10 kg", "₹999"]], best: 1, photo: "rice", tint: "#2A2208", accent: "#854D0E" })),
  t("qty-spices", "Quantity · Spices", "offer", () => L.quantity({ shop: "Masala Bazaar", name: "Stone-Ground Masala", label: "Buy more, pay less", tiers: [["100 g", "₹60"], ["250 g", "₹140"], ["500 g", "₹260"]], best: 2, photo: "spices", tint: "#3A1204", accent: "#9A3412" })),

  // ── Food with sizes ────────────────────────────────────────────────────────
  t("product-food-sizes", "Food with Sizes", "custom", () => L.foodSizes({ shop: "Slice Point", label: "Hot & fresh", name: "Farmhouse Pizza", options: ["Medium  ₹249", "Large  ₹399"], info: "Ready in 20 min · free delivery nearby", cta: "Order now", photo: "pizza", bg: "#1C1007", accent: "#FDBA74" })),
  t("food-burger", "Food · Burger", "custom", () => L.foodSizes({ shop: "Grill Street", label: "Hot & juicy", name: "Double Cheese Burger", options: ["Single  ₹149", "Double  ₹219"], info: "Ready in 15 min · add fries ₹49", cta: "Order now", photo: "burger2", bg: "#1A0F08", accent: "#FB923C" })),
  t("food-chai", "Food · Chai", "custom", () => L.foodSizes({ shop: "Chai Adda", label: "Fresh brew", name: "Masala Chai", options: ["Cutting  ₹15", "Full  ₹25"], info: "Served hot · open 6 AM to 11 PM", cta: "Order now", photo: "tea", bg: "#1E1208", accent: "#FCD34D" })),
  t("food-bowl", "Food · Bowl", "custom", () => L.foodSizes({ shop: "Fit Bowl Kitchen", label: "Healthy & fresh", name: "Protein Power Bowl", options: ["Regular  ₹199", "Large  ₹279"], info: "High protein · 450 kcal", cta: "Order now", photo: "buddhaBowl", bg: "#0E2118", accent: "#86EFAC" })),

  // ── Bottom bar ─────────────────────────────────────────────────────────────
  t("bar-sneaker", "Bottom Bar · Sneaker", "new-arrival", () => L.bottomBar({ shop: "Step Up Shoes", tag: "Free delivery", name: "Everyday Runner", price: "₹1,899", mrp: "₹2,499", cta: "Buy now", photo: "sneaker", accent: "#2563EB" })),
  t("bar-sofa", "Bottom Bar · Sofa", "new-stock", () => L.bottomBar({ shop: "Home Nest", tag: "Free installation", name: "Velvet 3-Seater Sofa", price: "₹24,999", mrp: "₹31,999", cta: "Book a visit", photo: "sofa", accent: "#0F766E" })),
  t("bar-pancakes", "Bottom Bar · Pancakes", "custom", () => L.bottomBar({ shop: "Morning Café", tag: "Breakfast till 11", name: "Honey Pancake Stack", price: "₹189", cta: "Order now", photo: "pancakes", accent: "#D97706" })),
  t("bar-jute-bag", "Bottom Bar · Jute Bag", "new-stock", () => L.bottomBar({ shop: "Paper Planet", tag: "Eco friendly", name: "Jute Shopping Bag", price: "₹149", mrp: "₹199", cta: "Buy now", photo: "tote", accent: "#65A30D" })),

  // ── Coupon ─────────────────────────────────────────────────────────────────
  t("coupon-bakery", "Coupon · Bakery", "offer", () => L.coupon({ shop: "Bake Studio", off: "20% OFF", offLabel: "on your next order", code: "SWEET20", note: "Show this at the counter", photo: "cupcakes", accent: "#DB2777" })),
  t("coupon-fashion", "Coupon · Fashion", "offer", () => L.coupon({ shop: "Lavender Lane", off: "₹300 OFF", offLabel: "on bills above ₹1,999", code: "STYLE300", note: "Valid till Sunday", photo: "clothesRack", accent: "#7C3AED" })),
  t("coupon-grocery", "Coupon · Grocery", "offer", () => L.coupon({ shop: "Patel Kirana", off: "10% OFF", offLabel: "on your monthly grocery", code: "KIRANA10", note: "Home delivery included", photo: "vegetables", accent: "#16A34A" })),
  t("coupon-cafe", "Coupon · Café", "offer", () => L.coupon({ shop: "Brew Bean Café", off: "₹50 OFF", offLabel: "on any two coffees", code: "BREW50", note: "Valid 4 PM to 7 PM", photo: "latte", accent: "#92400E" })),

  // ── Price drop ─────────────────────────────────────────────────────────────
  t("drop-headphones", "Price Drop · Headphones", "sale", () => L.priceDrop({ shop: "SoundHub", label: "Price dropped", name: "Wired Studio Headphones", oldPrice: "₹2,499", newPrice: "₹1,799", save: "You save ₹700", cta: "Buy now", photo: "headphones2", bg: "#F5F7FB", accent: "#DC2626" })),
  t("drop-jacket", "Price Drop · Jacket", "sale", () => L.priceDrop({ shop: "Denim Den", label: "Price dropped", name: "Rust Bomber Jacket", oldPrice: "₹2,999", newPrice: "₹2,199", save: "Save ₹800", cta: "Try it on", photo: "bomber", bg: "#F4F4F5", accent: "#B91C1C" })),
  t("drop-speaker", "Price Drop · Speaker", "sale", () => L.priceDrop({ shop: "Tech Bazaar", label: "New lower price", name: "Bookshelf Speakers", oldPrice: "₹4,999", newPrice: "₹3,499", save: "Save ₹1,500", cta: "Buy now", photo: "speaker", bg: "#EFF6F6", accent: "#0F766E" })),
  t("drop-bracelet", "Price Drop · Bracelet", "sale", () => L.priceDrop({ shop: "Gold Leaf Jewellers", label: "Price dropped", name: "Diamond Bracelet", oldPrice: "₹59,999", newPrice: "₹49,999", save: "Save ₹10,000", cta: "Visit store", photo: "diamondBracelet", bg: "#F6F3EE", accent: "#A16207" })),

  // ── Big sale ───────────────────────────────────────────────────────────────
  t("sale-fashion", "Big Sale · Fashion", "sale", () => L.bigSale({ word: "SALE", sub: "Up to 50% off", label: "On all summer wear this week", cta: "Shop now", photo: "redDress", bg: "#FDE047", ink: INK, accent: "#DC2626", ctaTone: "dark" })),
  t("sale-shoes", "Big Sale · Shoes", "sale", () => L.bigSale({ word: "SALE", sub: "Flat 30% off", label: "Every pair of shoes in store", cta: "Visit store", photo: "brownShoes", bg: "#111827", ink: WHITE, accent: "#FBBF24", ctaTone: "light" })),
  t("sale-electronics", "Big Sale · Electronics", "sale", () => L.bigSale({ word: "SALE", sub: "Up to 40% off", label: "Headphones, speakers and more", cta: "See deals", photo: "headphones3", bg: "#1D4ED8", ink: WHITE, accent: "#FDE047", ctaTone: "light" })),
  t("sale-home", "Big Sale · Home", "sale", () => L.bigSale({ word: "SALE", sub: "Up to 35% off", label: "Furniture and home décor", cta: "Visit store", photo: "livingRoom", bg: "#ECFDF5", ink: "#064E3B", accent: "#059669", ctaTone: "dark" })),

  // ── Four-product grid ──────────────────────────────────────────────────────
  t("four-fashion", "Four · Fashion", "new-arrival", () => L.fourGrid({ label: "Lavender Lane", title: "New in this week", info: "4 new styles · from ₹999", cta: "See all", items: [{ photo: "redDress", name: "Maxi", price: "₹1,899" }, { photo: "whiteDress", name: "Sundress", price: "₹1,850" }, { photo: "knitTop", name: "Knit Top", price: "₹999" }, { photo: "joggers", name: "Joggers", price: "₹1,199" }], bg: "#FAF5FF", ink: "#3B0764" })),
  t("four-bakery", "Four · Bakery", "new-stock", () => L.fourGrid({ label: "Bake Studio", title: "Today's bakes", info: "Fresh every morning", cta: "Order now", items: [{ photo: "cupcakes", name: "Cupcakes", price: "₹299" }, { photo: "donuts", name: "Donuts", price: "₹60" }, { photo: "cookies", name: "Cookies", price: "₹149" }, { photo: "cakeSlice", name: "Cake slice", price: "₹120" }], bg: "#2A1810", ink: WHITE })),
  t("four-gadgets", "Four · Gadgets", "new-stock", () => L.fourGrid({ label: "Tech Bazaar", title: "Desk setup deals", info: "Free delivery in town", cta: "See all", items: [{ photo: "keyboard", name: "Keyboard", price: "₹1,299" }, { photo: "mouse", name: "Mouse", price: "₹699" }, { photo: "headphones2", name: "Audio", price: "₹1,799" }, { photo: "speaker", name: "Speaker", price: "₹3,499" }], bg: "#0B1B2B", ink: WHITE })),
  t("four-fruits", "Four · Fruits", "new-stock", () => L.fourGrid({ label: "Fresh Fruits Corner", title: "Fruit basket", info: "Delivered by 10 AM", cta: "Order now", items: [{ photo: "mangoes", name: "Mangoes", price: "₹599" }, { photo: "pineapple", name: "Pineapple", price: "₹45" }, { photo: "cherries", name: "Cherries", price: "₹299" }, { photo: "apples", name: "Apples", price: "₹180" }], bg: "#F0FDF4", ink: "#14532D" })),

  // ── Polaroid ───────────────────────────────────────────────────────────────
  t("polaroid-earrings", "Polaroid · Earrings", "new-arrival", () => L.polaroid({ shop: "Gold Leaf Jewellers", label: "Handcrafted", name: "Sapphire Drop Earrings", price: "₹6,200", cta: "Visit store", caption: "made to order", photo: "earrings", bg: "#F5EFE6", ink: "#2B1E0F" })),
  t("polaroid-cake", "Polaroid · Cake", "custom", () => L.polaroid({ shop: "Sweet Tooth Bakery", label: "Celebration cakes", name: "Chocolate Truffle Cake", price: "₹549", cta: "Pre-order", caption: "baked fresh daily", photo: "cake", bg: "#FBEFEA", ink: "#3B1D12" })),
  t("polaroid-garden", "Polaroid · Garden", "new-stock", () => L.polaroid({ shop: "Green Pot Nursery", label: "Garden ready", name: "Potting Mix & Tools", price: "₹349", mrp: "₹449", cta: "Visit nursery", caption: "for your balcony", photo: "gardening", bg: "#EEF3E8", ink: "#1E3A1E" })),
  t("polaroid-books", "Polaroid · Books", "new-stock", () => L.polaroid({ shop: "Paper Planet", label: "Back to school", name: "Notebooks & Books", price: "₹99", cta: "Visit store", caption: "school essentials", photo: "books", bg: "#EFF4FB", ink: "#0F2A4A" })),

  // ── Menu card ──────────────────────────────────────────────────────────────
  t("menu-south-indian", "Menu · South Indian", "custom", () => L.menuCard({ label: "Today's special", title: "South Indian Menu", dishes: [["Idli Sambar", "₹60"], ["Masala Dosa", "₹90"], ["Filter Coffee", "₹30"]], photo: "idli", bg: "#0E2016", accent: "#FACC15" })),
  t("menu-dinner", "Menu · Dinner", "custom", () => L.menuCard({ label: "Masala House", title: "Tonight's Specials", dishes: [["Paneer Masala", "₹220"], ["Dal Makhani", "₹180"], ["Butter Naan", "₹40"]], photo: "curry", bg: "#1F0C06", accent: "#F97316" })),
  t("menu-street-food", "Menu · Street Food", "custom", () => L.menuCard({ label: "Mumbai Bites", title: "Evening Menu", dishes: [["Pav Bhaji", "₹110"], ["Vada Pav", "₹25"], ["Misal Pav", "₹90"]], photo: "pav", bg: "#2A1104", accent: "#FCD34D" })),
  t("menu-weekend", "Menu · Weekend", "custom", () => L.menuCard({ label: "The Green Table", title: "Weekend Menu", dishes: [["Garden Salad", "₹260"], ["Risotto", "₹380"], ["Tiramisu", "₹240"]], photo: "gourmet", bg: "#101820", accent: "#A3E635" })),

  // ── Floating card ──────────────────────────────────────────────────────────
  t("float-handbag", "Floating · Handbag", "new-arrival", () => L.floatingCard({ shop: "Bag Story", label: "New colour", name: "Cherry Red Handbag", price: "₹2,299", cta: "Visit store", photo: "redBag", from: "#FDE2E4", to: "#F9A8B4", ink: INK, tagColor: "#BE123C" })),
  t("float-watch", "Floating · Watch", "new-arrival", () => L.floatingCard({ shop: "Classic Watches", label: "Gift idea", name: "Minimal Leather Watch", price: "₹2,799", cta: "Visit store", photo: "wristWatch", from: "#1E3A8A", to: "#0F172A", ink: WHITE, tagColor: "#1E3A8A" })),
  t("float-serum", "Floating · Serum", "new-arrival", () => L.floatingCard({ shop: "Glow Beauty", label: "Skin care", name: "Vitamin C Face Serum", price: "₹549", cta: "Order now", photo: "serum", from: "#FED7AA", to: "#FDBA74", ink: "#431407", tagColor: "#C2410C" })),
  t("float-chocolate", "Floating · Chocolate", "new-arrival", () => L.floatingCard({ shop: "Cocoa Craft", label: "Handmade", name: "Dark Chocolate Bar", price: "₹180", cta: "Order now", photo: "chocolate", from: "#78350F", to: "#2A1205", ink: WHITE, tagColor: "#78350F" })),

  // ── Buy one get one ────────────────────────────────────────────────────────
  t("bogo-donuts", "BOGO · Donuts", "offer", () => L.bogo({ shop: "Bake Studio", offer: "Buy 1 Get 1 Free", name: "On all glazed donuts", info: "Every Friday, 4 to 8 PM", cta: "Grab yours", photo: "donuts", bg: "#3B0A2A", accent: "#EC4899" })),
  t("bogo-tees", "BOGO · Tees", "offer", () => L.bogo({ shop: "Cotton Co.", offer: "Buy 1 Get 1 Free", name: "On all cotton tees", info: "This weekend only", cta: "Visit store", photo: "tee", bg: "#111827", accent: "#F59E0B" })),
  t("bogo-pizza", "BOGO · Pizza", "offer", () => L.bogo({ shop: "Slice Point", offer: "Buy 1 Get 1 Free", name: "All medium pizzas", info: "Every Tuesday · dine-in or takeaway", cta: "Order now", photo: "pizza2", bg: "#1C0A05", accent: "#DC2626" })),
  t("bogo-ice-cream", "BOGO · Ice Cream", "offer", () => L.bogo({ shop: "Cream Corner", offer: "Buy 2 Get 1 Free", name: "On all ice cream cones", info: "Till stocks last", cta: "Grab yours", photo: "iceCream", bg: "#4A2B05", accent: "#F59E0B" })),

  // ── Customer review ────────────────────────────────────────────────────────
  t("review-chai", "Review · Chai", "custom", () => L.review({ shop: "Chai Adda", quote: "“Best masala chai in the whole area!”", author: "Priya S. · regular customer", name: "Masala Chai", price: "₹25", photo: "chai", bg: "#FFF8EE", ink: "#2A1A0A", accent: "#D97706" })),
  t("review-cake", "Review · Cake", "custom", () => L.review({ shop: "Sweet Tooth Bakery", quote: "“The berry cake was gone in minutes!”", author: "Rahul M. · ordered for a birthday", name: "Berry Cream Cake", price: "₹120", photo: "cakeSlice", bg: "#FFF1F2", ink: "#4C0519", accent: "#E11D48" })),
  t("review-shoes", "Review · Shoes", "custom", () => L.review({ shop: "Step Up Shoes", quote: "“Comfortable from day one. Great fit!”", author: "Arjun K. · verified buyer", name: "Leather Oxford Shoes", price: "₹2,999", photo: "brownShoes", bg: "#F7F3EE", ink: "#2A1A0E", accent: "#B45309" })),
  t("review-salad", "Review · Salad", "custom", () => L.review({ shop: "Fit Bowl Kitchen", quote: "“Fresh, filling and actually tasty.”", author: "Neha P. · lunch regular", name: "Chicken Salad Bowl", price: "₹229", photo: "saladBowl", bg: "#F0FDF4", ink: "#052E16", accent: "#16A34A" })),
];

function buildTemplate(entry: Entry) {
  const now = new Date().toISOString();
  const { background, elements } = entry.design();
  return NotificationDesignSchema.parse({
    schemaVersion: 2,
    id: entry.slug,
    name: entry.name,
    category: CATEGORY_TYPES[entry.categorySlug],
    status: "DRAFT",
    canvas: { width: 400, height: 200, background: { type: "SOLID", color: background } },
    timeline: { durationMs: 3000 },
    elements,
    metadata: { createdAt: now, updatedAt: now, source: "SHOPROOM_TEMPLATE" },
  });
}

export const TEMPLATES = CATALOG.map((entry) => ({
  slug: entry.slug,
  name: entry.name,
  categorySlug: entry.categorySlug,
  build: () => buildTemplate(entry),
}));
