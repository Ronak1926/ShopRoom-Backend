/**
 * prisma/templates/shopTypes.ts — The kinds of local shop the generated
 * templates are written for: made-up shop names, real-looking products with a
 * matching sample photo and a price, and two colour palettes each.
 *
 * Length limits the layouts were sized for: `name` up to 22 characters,
 * `short` (tiles, rate cards, menus) up to 9 (enforced in generated.ts),
 * shop names up to 19.
 */

import type { PhotoName } from "./photos.js";

export interface Product {
  name: string;
  short: string;
  photo: PhotoName;
  /** Price in rupees. */
  price: number;
  /** Selling unit for loose goods ("kg", "dozen", "litre"), shown as "/kg". */
  unit?: string;
}

export interface Palette {
  /** Deep colour behind light text and photo scrims. */
  tint: string;
  /** Light page colour behind dark text. */
  light: string;
  /** Prices, labels and buttons. */
  accent: string;
}

/** What kind of shop this is; decides which specialised layouts apply. */
export type ShopKind = "fresh" | "grocery" | "food" | "apparel" | "goods";

export interface ShopType {
  key: string;
  label: string;
  kind: ShopKind;
  shops: [string, string];
  products: Product[];
  /** A wide shot of the shop or produce, for announcements and events. */
  scene: PhotoName;
  palettes: [Palette, Palette];
  newLabel: string;
  cta: string;
  event: { title: string; detail: string };
}

export const SHOP_TYPES: ShopType[] = [
  {
    key: "fruits-veg", label: "Fruits & Veg", kind: "fresh", shops: ["Sharma Sabzi", "Fresh Fruits Corner"],
    products: [
      { name: "Farm Fresh Vegetables", short: "Veggies", photo: "vegetables", price: 40, unit: "kg" },
      { name: "Kashmiri Apples", short: "Apples", photo: "apples", price: 180, unit: "kg" },
      { name: "Alphonso Mangoes", short: "Mangoes", photo: "mangoes", price: 599, unit: "dozen" },
      { name: "Nagpur Oranges", short: "Oranges", photo: "oranges", price: 90, unit: "kg" },
      { name: "Sweet Watermelon", short: "Melon", photo: "watermelon", price: 25, unit: "kg" },
      { name: "Juicy Pineapple", short: "Pineapple", photo: "pineapple", price: 45, unit: "pc" },
      { name: "Fresh Cherries", short: "Cherries", photo: "cherries", price: 299, unit: "250g" },
      { name: "Seasonal Fruit Box", short: "Fruit box", photo: "fruitMix", price: 349 },
      { name: "Salad Veggies Pack", short: "Salads", photo: "veggiesFresh", price: 99 },
    ],
    scene: "fruitMarket",
    palettes: [{ tint: "#0F3D2E", light: "#F2FAF4", accent: "#16A34A" }, { tint: "#3B1A05", light: "#FFF7ED", accent: "#EA580C" }],
    newLabel: "Fresh today", cta: "Order now", event: { title: "Organic Farmers Day", detail: "Taste before you buy · 8 AM to 1 PM" },
  },
  {
    key: "kirana", label: "Kirana", kind: "grocery", shops: ["Patel Kirana", "Apna Bazaar"],
    products: [
      { name: "Premium Basmati Rice", short: "Basmati", photo: "rice", price: 110, unit: "kg" },
      { name: "Whole Spices Pack", short: "Spices", photo: "spices", price: 60, unit: "100g" },
      { name: "Pure Forest Honey", short: "Honey", photo: "honey", price: 299, unit: "500g" },
      { name: "Farm Fresh Eggs", short: "Eggs", photo: "eggs", price: 84, unit: "dozen" },
      { name: "Brown Bread Loaf", short: "Bread", photo: "slicedBread", price: 55 },
      { name: "Floor Cleaner Spray", short: "Cleaner", photo: "cleaning", price: 149 },
      { name: "Herbal Bath Soap", short: "Soap", photo: "soap", price: 45 },
    ],
    scene: "supermarket",
    palettes: [{ tint: "#3A2A05", light: "#FEFCE8", accent: "#CA8A04" }, { tint: "#0B2545", light: "#EFF6FF", accent: "#2563EB" }],
    newLabel: "New stock in", cta: "Order now", event: { title: "Monthly Grocery Fair", detail: "Extra savings on 200+ items" },
  },
  {
    key: "dairy", label: "Dairy", kind: "grocery", shops: ["Daily Dairy", "Gokul Milk Centre"],
    products: [
      { name: "Fresh Cow Milk", short: "Milk", photo: "milkPour", price: 62, unit: "litre" },
      { name: "Fruit Yogurt Cups", short: "Yogurt", photo: "yogurt", price: 40 },
      { name: "Farm Fresh Eggs", short: "Eggs", photo: "eggs", price: 84, unit: "dozen" },
      { name: "Pure Forest Honey", short: "Honey", photo: "honey", price: 299, unit: "500g" },
    ],
    scene: "milkPour",
    palettes: [{ tint: "#0B2545", light: "#F0F7FF", accent: "#0284C7" }, { tint: "#1E3A2A", light: "#F3FAF5", accent: "#15803D" }],
    newLabel: "Fresh this morning", cta: "Subscribe", event: { title: "Milk Subscription Week", detail: "First week free on yearly plans" },
  },
  {
    key: "bakery", label: "Bakery", kind: "food", shops: ["Bake Studio", "Sweet Tooth Bakery"],
    products: [
      { name: "Chocolate Truffle Cake", short: "Truffle", photo: "cake", price: 549 },
      { name: "Berry Cream Cake", short: "Cake", photo: "cakeSlice", price: 120 },
      { name: "Strawberry Cupcakes", short: "Cupcakes", photo: "cupcakes", price: 299 },
      { name: "Vanilla Cupcake", short: "Cupcake", photo: "cupcakeYellow", price: 60 },
      { name: "Glazed Donuts", short: "Donuts", photo: "donuts", price: 60 },
      { name: "Choco Chip Cookies", short: "Cookies", photo: "cookies", price: 149 },
      { name: "Multigrain Bread", short: "Bread", photo: "breadLoaves", price: 90 },
      { name: "Sourdough Loaf", short: "Loaf", photo: "slicedBread", price: 120 },
    ],
    scene: "cafe",
    palettes: [{ tint: "#2A1810", light: "#FDF6EE", accent: "#DB2777" }, { tint: "#3B1D12", light: "#FFF5EB", accent: "#C2410C" }],
    newLabel: "Freshly baked", cta: "Pre-order", event: { title: "Cake Tasting Saturday", detail: "Free tasting · 4 PM to 8 PM" },
  },
  {
    key: "sweets", label: "Desserts", kind: "food", shops: ["Cream Corner", "Cocoa Craft"],
    products: [
      { name: "Dark Chocolate Bar", short: "Chocolate", photo: "chocolate", price: 180 },
      { name: "Chocolate Slab", short: "Slab", photo: "chocolate2", price: 240 },
      { name: "Vanilla Swirl Cone", short: "Cone", photo: "iceCream", price: 60 },
      { name: "Choco Chip Cookies", short: "Cookies", photo: "cookies", price: 149 },
      { name: "Berry Yogurt Parfait", short: "Parfait", photo: "yogurt", price: 110 },
    ],
    scene: "chocolate",
    palettes: [{ tint: "#2A1205", light: "#FFF8F0", accent: "#B45309" }, { tint: "#3B0A2A", light: "#FFF1F7", accent: "#DB2777" }],
    newLabel: "Just made", cta: "Order now", event: { title: "Dessert Festival", detail: "20 new flavours this weekend" },
  },
  {
    key: "cafe", label: "Café", kind: "food", shops: ["Brew Bean Café", "Chai Adda"],
    products: [
      { name: "Hazelnut Latte", short: "Latte", photo: "latte", price: 160 },
      { name: "Classic Cappuccino", short: "Coffee", photo: "coffeeCups", price: 140 },
      { name: "Roasted Coffee Beans", short: "Beans", photo: "coffeeBeans", price: 450, unit: "250g" },
      { name: "Masala Chai", short: "Chai", photo: "tea", price: 25 },
      { name: "Chai & Cookies", short: "Chai set", photo: "chai", price: 79 },
      { name: "Mint Mojito", short: "Mojito", photo: "mojito", price: 120 },
      { name: "Fresh Pineapple Juice", short: "Juice", photo: "juice", price: 90 },
      { name: "Honey Pancake Stack", short: "Pancakes", photo: "pancakes", price: 189 },
    ],
    scene: "cafe",
    palettes: [{ tint: "#1C120C", light: "#FBF5EF", accent: "#92400E" }, { tint: "#0F2A2A", light: "#F0FAF8", accent: "#0F766E" }],
    newLabel: "On the menu", cta: "Order now", event: { title: "Open Mic Evening", detail: "Live music · Friday from 7 PM" },
  },
  {
    key: "restaurant", label: "Restaurant", kind: "food", shops: ["Masala House", "Annapurna Bhojnalay"],
    products: [
      { name: "Hyderabadi Biryani", short: "Biryani", photo: "biryani", price: 249 },
      { name: "Paneer Butter Masala", short: "Paneer", photo: "curry", price: 220 },
      { name: "Gujarati Thali", short: "Thali", photo: "thali", price: 229 },
      { name: "Idli Sambar", short: "Idli", photo: "idli", price: 60 },
      { name: "Mini Idli Plate", short: "Mini idli", photo: "idliPlate", price: 80 },
      { name: "Pav Bhaji", short: "Pav bhaji", photo: "pav", price: 110 },
      { name: "Punjabi Samosa", short: "Samosa", photo: "samosa", price: 20 },
      { name: "Seekh Kebab Platter", short: "Kebabs", photo: "kebab", price: 299 },
      { name: "Chef's Special Platter", short: "Platter", photo: "foodPlates", price: 399 },
    ],
    scene: "restaurant",
    palettes: [{ tint: "#1F0C06", light: "#FFF7ED", accent: "#EA580C" }, { tint: "#0E2016", light: "#F4FAF3", accent: "#CA8A04" }],
    newLabel: "Chef's special", cta: "Order now", event: { title: "Sunday Family Buffet", detail: "Kids eat free · 12 to 4 PM" },
  },
  {
    key: "fast-food", label: "Fast Food", kind: "food", shops: ["Slice Point", "Grill Street"],
    products: [
      { name: "Farmhouse Pizza", short: "Veggie", photo: "pizza", price: 249 },
      { name: "Chef's Special Pizza", short: "Special", photo: "pizza2", price: 349 },
      { name: "Classic Burger", short: "Burger", photo: "burger", price: 129 },
      { name: "Double Cheese Burger", short: "Cheese", photo: "burger2", price: 179 },
      { name: "Mint Mojito", short: "Mojito", photo: "mojito", price: 99 },
      { name: "Punjabi Samosa", short: "Samosa", photo: "samosa", price: 20 },
    ],
    scene: "restaurant",
    palettes: [{ tint: "#1A0F08", light: "#FFF7ED", accent: "#DC2626" }, { tint: "#1C1007", light: "#FFFBEB", accent: "#D97706" }],
    newLabel: "Hot & fresh", cta: "Order now", event: { title: "Pizza Party Night", detail: "Unlimited slices · Saturday 7 PM" },
  },
  {
    key: "healthy", label: "Healthy Food", kind: "food", shops: ["Fit Bowl Kitchen", "The Green Table"],
    products: [
      { name: "Chicken Salad Bowl", short: "Salad", photo: "saladBowl", price: 229 },
      { name: "Protein Power Bowl", short: "Bowl", photo: "buddhaBowl", price: 199 },
      { name: "Chef's Tasting Plate", short: "Tasting", photo: "gourmet", price: 320 },
      { name: "Fresh Fruit Bowl", short: "Fruits", photo: "fruitBowl", price: 149 },
      { name: "Berry Yogurt Parfait", short: "Parfait", photo: "yogurt", price: 110 },
      { name: "Fresh Pineapple Juice", short: "Juice", photo: "juice", price: 90 },
    ],
    scene: "veggiesFresh",
    palettes: [{ tint: "#0E2118", light: "#F0FDF4", accent: "#16A34A" }, { tint: "#101820", light: "#F7FEE7", accent: "#65A30D" }],
    newLabel: "Healthy & fresh", cta: "Order now", event: { title: "Healthy Eating Week", detail: "Free nutrition check with any bowl" },
  },
  {
    key: "womens-fashion", label: "Women's Fashion", kind: "apparel", shops: ["Riya Boutique", "Lavender Lane"],
    products: [
      { name: "Banarasi Silk Saree", short: "Saree", photo: "saree", price: 4299 },
      { name: "Kanjivaram Silk Saree", short: "Silk", photo: "silkSaree", price: 7999 },
      { name: "Festive Lehenga", short: "Lehenga", photo: "lehenga", price: 5499 },
      { name: "Chikankari Anarkali", short: "Anarkali", photo: "anarkali", price: 2450 },
      { name: "Flowing Maxi Dress", short: "Maxi", photo: "redDress", price: 1899 },
      { name: "Floral Wrap Dress", short: "Wrap", photo: "redDress2", price: 1650 },
      { name: "Cotton Summer Dress", short: "Sundress", photo: "whiteDress", price: 1850 },
      { name: "Crochet Knit Top", short: "Knit top", photo: "knitTop", price: 999 },
    ],
    scene: "boutique",
    palettes: [{ tint: "#3A0A12", light: "#FFF1F2", accent: "#BE123C" }, { tint: "#2E1065", light: "#FAF5FF", accent: "#7C3AED" }],
    newLabel: "New in store", cta: "Visit store", event: { title: "Festive Trunk Show", detail: "New collection preview · Sunday" },
  },
  {
    key: "mens-fashion", label: "Men's Fashion", kind: "apparel", shops: ["Denim Den", "Cotton Co."],
    products: [
      { name: "Linen Casual Shirts", short: "Shirts", photo: "shirts", price: 799 },
      { name: "Classic Cotton Tee", short: "Tee", photo: "tee", price: 399 },
      { name: "Relaxed Sweatshirt", short: "Crewneck", photo: "sweatshirt", price: 899 },
      { name: "Fleece Hoodie", short: "Hoodie", photo: "hoodie", price: 1299 },
      { name: "Rust Bomber Jacket", short: "Bomber", photo: "bomber", price: 2199 },
      { name: "Everyday Shirts", short: "Shirts", photo: "clothesRack2", price: 699 },
    ],
    scene: "clothingStore",
    palettes: [{ tint: "#0F172A", light: "#F1F5F9", accent: "#2563EB" }, { tint: "#1E293B", light: "#F5F5F4", accent: "#B45309" }],
    newLabel: "Just arrived", cta: "Visit store", event: { title: "End of Season Fit Day", detail: "Free alterations all weekend" },
  },
  {
    key: "kids", label: "Kids & Toys", kind: "apparel", shops: ["Little Wonders", "Tiny Tots Store"],
    products: [
      { name: "Kids Summer Set", short: "Kids set", photo: "kidsClothes", price: 699 },
      { name: "Little Gent Outfit", short: "Outfit", photo: "kidsOutfit", price: 899 },
      { name: "Soft Teddy Bear", short: "Teddy", photo: "teddy", price: 499 },
      { name: "Baby Play Set", short: "Play set", photo: "babyToys", price: 1199 },
      { name: "Toy Racing Car", short: "Toy car", photo: "toyCar", price: 349 },
      { name: "Die-cast Car Set", short: "Car set", photo: "toyCars", price: 599 },
      { name: "Wooden Train Set", short: "Train", photo: "woodenTrain", price: 1299 },
    ],
    scene: "babyToys",
    palettes: [{ tint: "#1E3A8A", light: "#EFF6FF", accent: "#F59E0B" }, { tint: "#4C1D95", light: "#FDF4FF", accent: "#EC4899" }],
    newLabel: "New for kids", cta: "Visit store", event: { title: "Kids Fun Saturday", detail: "Games, gifts and story time" },
  },
  {
    key: "footwear", label: "Footwear", kind: "apparel", shops: ["Step Up Shoes", "Stiletto Lane"],
    products: [
      { name: "Suede Loafers", short: "Loafers", photo: "loafers", price: 1799 },
      { name: "Everyday Runner", short: "Runner", photo: "sneaker", price: 1899 },
      { name: "Printed Heels", short: "Heels", photo: "heels", price: 1499 },
      { name: "Leather Oxford Shoes", short: "Oxfords", photo: "brownShoes", price: 2999 },
    ],
    scene: "brownShoes",
    palettes: [{ tint: "#1C1917", light: "#F5F5F4", accent: "#B45309" }, { tint: "#0C4A6E", light: "#F0F9FF", accent: "#DB2777" }],
    newLabel: "New pair in", cta: "Try them on", event: { title: "Shoe Fitting Week", detail: "Free foot measurement in store" },
  },
  {
    key: "bags", label: "Bags", kind: "goods", shops: ["Bag Story", "Carry All"],
    products: [
      { name: "Leather Handbag", short: "Handbag", photo: "redBag", price: 2299 },
      { name: "Wicker Tote Bag", short: "Tote", photo: "orangeBag", price: 1299 },
      { name: "Teal Satchel", short: "Satchel", photo: "tealBag", price: 1899 },
      { name: "Everyday Backpack", short: "Backpack", photo: "backpack", price: 1199 },
      { name: "Jute Shopping Bag", short: "Jute bag", photo: "tote", price: 149 },
    ],
    scene: "shoppingBags",
    palettes: [{ tint: "#3B0A0A", light: "#FFF5F5", accent: "#DC2626" }, { tint: "#0F2A2A", light: "#F0FDFA", accent: "#0D9488" }],
    newLabel: "New colour", cta: "Visit store", event: { title: "Bag Exchange Week", detail: "Bring an old bag, get ₹300 off" },
  },
  {
    key: "jewellery", label: "Jewellery", kind: "goods", shops: ["Gold Leaf Jewellers", "Shree Jewels"],
    products: [
      { name: "Gold Pendant Chain", short: "Pendant", photo: "necklace", price: 8500 },
      { name: "Sapphire Drop Earrings", short: "Earrings", photo: "earrings", price: 6200 },
      { name: "Solitaire Ring", short: "Ring", photo: "ring", price: 24000 },
      { name: "Rose Gold Bracelet", short: "Bracelet", photo: "bracelet", price: 9800 },
      { name: "Diamond Bracelet", short: "Diamond", photo: "diamondBracelet", price: 49999 },
      { name: "Pearl Necklace Set", short: "Pearls", photo: "pearls", price: 4999 },
    ],
    scene: "giftsGold",
    palettes: [{ tint: "#1A1407", light: "#FBF7EE", accent: "#A16207" }, { tint: "#2A0F1A", light: "#FDF2F8", accent: "#BE185D" }],
    newLabel: "Handcrafted", cta: "Visit store", event: { title: "Bridal Jewellery Show", detail: "300+ designs · by appointment" },
  },
  {
    key: "watches", label: "Watches & Eyewear", kind: "goods", shops: ["Time House", "Specs & More"],
    products: [
      { name: "Classic White Watch", short: "White", photo: "watches", price: 3499 },
      { name: "Leather Strap Watch", short: "Leather", photo: "wristWatch", price: 2799 },
      { name: "Smart Watch S2", short: "Wearable", photo: "smartwatch", price: 2999 },
      { name: "Round Sunglasses", short: "Shades", photo: "sunglasses", price: 899 },
    ],
    scene: "wristWatch",
    palettes: [{ tint: "#0F172A", light: "#F1F5F9", accent: "#1D4ED8" }, { tint: "#1C1917", light: "#FAFAF9", accent: "#0F766E" }],
    newLabel: "New arrival", cta: "Visit store", event: { title: "Free Eye Check Camp", detail: "Every Sunday · 10 AM to 2 PM" },
  },
  {
    key: "electronics", label: "Electronics", kind: "goods", shops: ["Tech Bazaar", "SoundHub"],
    products: [
      { name: "Studio Headphones", short: "Headset", photo: "headphones", price: 1299 },
      { name: "Wired Headphones", short: "Wired", photo: "headphones2", price: 1799 },
      { name: "Over-Ear Headphones", short: "Over-ear", photo: "headphones3", price: 2499 },
      { name: "Bookshelf Speakers", short: "Speakers", photo: "speaker", price: 3499 },
      { name: "Wireless Keyboard", short: "Keyboard", photo: "keyboard", price: 1299 },
      { name: "Wireless Mouse", short: "Mouse", photo: "mouse", price: 699 },
      { name: "Slim Laptop 14 inch", short: "Laptop", photo: "laptop", price: 54990 },
    ],
    scene: "speaker",
    palettes: [{ tint: "#0B1B2B", light: "#F0F9FF", accent: "#2563EB" }, { tint: "#111827", light: "#F9FAFB", accent: "#7C3AED" }],
    newLabel: "Just launched", cta: "Buy now", event: { title: "Gadget Demo Day", detail: "Try before you buy · Saturday" },
  },
  {
    key: "home", label: "Home & Furniture", kind: "goods", shops: ["Home Nest", "Comfort Furnishings"],
    products: [
      { name: "Velvet 3-Seater Sofa", short: "Sofa", photo: "sofa", price: 24999 },
      { name: "Tufted Accent Chair", short: "Chair", photo: "chair", price: 6499 },
      { name: "Modern Lounge Chair", short: "Lounge", photo: "greyChair", price: 7999 },
      { name: "Living Room Set", short: "Lounge", photo: "livingRoom", price: 39999 },
      { name: "Photo Frame Wall Set", short: "Frames", photo: "wallDecor", price: 1299 },
      { name: "Modular Kitchen", short: "Kitchen", photo: "kitchen", price: 89999 },
      { name: "Power Blender", short: "Blender", photo: "blender", price: 2199 },
    ],
    scene: "livingRoom",
    palettes: [{ tint: "#0D2B25", light: "#F0F7F4", accent: "#0F766E" }, { tint: "#2A1A0E", light: "#FAF6F1", accent: "#B45309" }],
    newLabel: "New in showroom", cta: "Book a visit", event: { title: "Home Makeover Expo", detail: "Free design consultation" },
  },
  {
    key: "plants-flowers", label: "Plants & Flowers", kind: "goods", shops: ["Green Pot Nursery", "Petals Florist"],
    products: [
      { name: "Desk Succulent", short: "Succulent", photo: "succulent", price: 199 },
      { name: "Mini Cactus Pot", short: "Cactus", photo: "cactus", price: 149 },
      { name: "Potting Mix & Tools", short: "Tools", photo: "gardening", price: 349 },
      { name: "Pink Tulip Bunch", short: "Tulips", photo: "tulips", price: 599 },
      { name: "Sunflower Bouquet", short: "Sunflower", photo: "sunflowers", price: 499 },
      { name: "Rose Bouquet", short: "Roses", photo: "bouquet", price: 799 },
      { name: "Wildflower Bunch", short: "Wild mix", photo: "wildflowers", price: 399 },
    ],
    scene: "flowerShop",
    palettes: [{ tint: "#1E3A1E", light: "#F0F7EC", accent: "#4D7C0F" }, { tint: "#4C0519", light: "#FFF1F2", accent: "#E11D48" }],
    newLabel: "Freshly cut", cta: "Order now", event: { title: "Balcony Garden Workshop", detail: "Learn to pot · Sunday 10 AM" },
  },
  {
    key: "beauty", label: "Beauty", kind: "goods", shops: ["Glow Beauty", "Glam Studio"],
    products: [
      { name: "Rose Glow Makeup Kit", short: "Makeup", photo: "makeup", price: 1150 },
      { name: "Vitamin C Face Serum", short: "Serum", photo: "serum", price: 549 },
      { name: "Perfume Collection", short: "Perfumes", photo: "perfumes", price: 1499 },
      { name: "Daily Skincare Set", short: "Skincare", photo: "skincareBottles", price: 899 },
      { name: "Handmade Soap Bars", short: "Soaps", photo: "soap", price: 249 },
    ],
    scene: "perfumes",
    palettes: [{ tint: "#3B0A24", light: "#FDF2F8", accent: "#DB2777" }, { tint: "#431407", light: "#FFF7ED", accent: "#C2410C" }],
    newLabel: "New launch", cta: "Order now", event: { title: "Free Makeover Day", detail: "Book a 20-minute session" },
  },
  {
    key: "pharmacy", label: "Pharmacy", kind: "goods", shops: ["Care Plus Pharmacy", "Wellness Chemist"],
    products: [
      { name: "Vitamin C Tablets", short: "Vitamin C", photo: "medicine", price: 180 },
      { name: "Daily Skincare Set", short: "Skincare", photo: "skincareBottles", price: 899 },
      { name: "Herbal Soap Bars", short: "Soaps", photo: "soap", price: 249 },
      { name: "Pure Forest Honey", short: "Honey", photo: "honey", price: 299 },
    ],
    scene: "medicine",
    palettes: [{ tint: "#0C2D48", light: "#EFF8FF", accent: "#0369A1" }, { tint: "#064E3B", light: "#ECFDF5", accent: "#059669" }],
    newLabel: "In stock now", cta: "Reserve now", event: { title: "Free Health Check Camp", detail: "BP and sugar test · Sunday" },
  },
  {
    key: "pets", label: "Pet Store", kind: "goods", shops: ["Paws & Tails", "Happy Pets"],
    products: [
      { name: "Pet Cotton T-Shirt", short: "Pet tee", photo: "dogShirt", price: 399 },
      { name: "Premium Dog Food", short: "Dog food", photo: "petFood", price: 899, unit: "3kg" },
      { name: "Cat Treats Pack", short: "Treats", photo: "cat", price: 249 },
      { name: "Leash & Collar Set", short: "Leash", photo: "dogs", price: 599 },
    ],
    scene: "dogs",
    palettes: [{ tint: "#1E3A8A", light: "#EFF6FF", accent: "#F59E0B" }, { tint: "#14532D", light: "#F0FDF4", accent: "#EA580C" }],
    newLabel: "New for pets", cta: "Visit store", event: { title: "Pet Adoption Day", detail: "Meet rescued pups · Sunday" },
  },
  {
    key: "fitness", label: "Sports & Fitness", kind: "goods", shops: ["Fit Gear", "Power Sports"],
    products: [
      { name: "Rubber Dumbbell Set", short: "Dumbbells", photo: "dumbbells", price: 2499 },
      { name: "Olympic Barbell", short: "Barbell", photo: "barbell", price: 6999 },
      { name: "Outdoor Basketball", short: "Ball", photo: "basketball", price: 899 },
      { name: "Battle Rope 12 m", short: "Rope", photo: "battleRopes", price: 2999 },
    ],
    scene: "dumbbells",
    palettes: [{ tint: "#111827", light: "#F3F4F6", accent: "#EF4444" }, { tint: "#0C4A6E", light: "#F0F9FF", accent: "#F59E0B" }],
    newLabel: "New gear in", cta: "Visit store", event: { title: "Free Fitness Trial", detail: "One free session with a trainer" },
  },
  {
    key: "hardware", label: "Hardware", kind: "goods", shops: ["Bharat Hardware", "Tool Point"],
    products: [
      { name: "Home Tool Kit", short: "Tool kit", photo: "nailsTools", price: 799 },
      { name: "Hand Tool Set", short: "Tool set", photo: "toolWall", price: 1999 },
      { name: "Steel Claw Hammer", short: "Hammer", photo: "hammer", price: 349 },
    ],
    scene: "toolWall",
    palettes: [{ tint: "#1C1917", light: "#FAFAF9", accent: "#EA580C" }, { tint: "#172554", light: "#EFF6FF", accent: "#EAB308" }],
    newLabel: "New stock in", cta: "Visit store", event: { title: "DIY Repair Workshop", detail: "Fix it yourself · Saturday 11 AM" },
  },
  {
    key: "stationery", label: "Stationery & Books", kind: "goods", shops: ["Paper Planet", "Book Nook"],
    products: [
      { name: "Colour Pencil Set", short: "Pencils", photo: "pencils", price: 199 },
      { name: "Story Books Set", short: "Books", photo: "books", price: 499 },
      { name: "Jute Shopping Bag", short: "Jute bag", photo: "tote", price: 149 },
    ],
    scene: "books",
    palettes: [{ tint: "#0F2A4A", light: "#EFF4FB", accent: "#2563EB" }, { tint: "#3B2414", light: "#FBF3EA", accent: "#B45309" }],
    newLabel: "Back to school", cta: "Visit store", event: { title: "Book Reading Hour", detail: "For kids · every Sunday 5 PM" },
  },
  {
    key: "gifts", label: "Gift Shop", kind: "goods", shops: ["Gift Galaxy", "Wrap & Bow"],
    products: [
      { name: "Surprise Gift Box", short: "Gift box", photo: "giftPink", price: 799 },
      { name: "Gold Wrap Hampers", short: "Hampers", photo: "giftsGold", price: 1499 },
      { name: "Handmade Hamper", short: "Hamper", photo: "giftBox", price: 999 },
      { name: "Christmas Décor Set", short: "Décor", photo: "christmas", price: 699 },
    ],
    scene: "shoppingBags",
    palettes: [{ tint: "#3B0764", light: "#FAF5FF", accent: "#C026D3" }, { tint: "#7F1D1D", light: "#FFF5F5", accent: "#DC2626" }],
    newLabel: "Gift idea", cta: "Visit store", event: { title: "Gift Wrapping Week", detail: "Free wrapping on every gift" },
  },
];
