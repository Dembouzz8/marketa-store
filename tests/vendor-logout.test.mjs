import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sidebarFile = "src/components/vendor/sidebar.tsx"
const source = fs.readFileSync(path.join(root, sidebarFile), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText

const Button = function Button() {}
const jsx = (type, props) => ({ type, props })
const component = () => null

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate))
  if (!tree || typeof tree !== "object" || !("type" in tree)) return []
  const children = nodes(tree.props?.children, predicate)
  return predicate(tree) ? [tree, ...children] : children
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function harness(signOut) {
  const states = []
  const signOutCalls = []
  const navigations = []
  let hookIndex = 0
  let clientCreations = 0

  const mocks = {
    "next/link": { __esModule: true, default: component },
    "next/navigation": { usePathname: () => "/vendor/dashboard" },
    "lucide-react": Object.fromEntries(
      ["LayoutDashboard", "LogOut", "Menu", "Package", "Settings", "ShoppingBag", "ShoppingCart", "Wallet", "X"]
        .map((name) => [name, component])
    ),
    react: {
      useState(initial) {
        const index = hookIndex++
        if (!(index in states)) states[index] = initial
        return [states[index], (next) => {
          states[index] = typeof next === "function" ? next(states[index]) : next
        }]
      },
      useRef(initial) {
        const index = hookIndex++
        if (!(index in states)) states[index] = { current: initial }
        return states[index]
      },
      useMemo(factory) {
        const index = hookIndex++
        if (!(index in states)) states[index] = factory()
        return states[index]
      },
    },
    "@/components/ui/button": { Button },
    "@/components/ui/separator": { Separator: component },
    "@/components/ui/sheet": {
      Sheet: component,
      SheetContent: component,
      SheetDescription: component,
      SheetTitle: component,
    },
    "@/lib/supabase-browser": {
      createSupabaseBrowserClient() {
        clientCreations++
        return { auth: { signOut: async (options) => {
          signOutCalls.push(options)
          return signOut()
        } } }
      },
    },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: Symbol.for("react.fragment") },
  }

  const compiledModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: compiledModule,
    exports: compiledModule.exports,
    window: { location: { assign: (url) => navigations.push(url) } },
    require(name) {
      if (name in mocks) return mocks[name]
      throw new Error(`Unexpected import: ${name}`)
    },
  }, { filename: sidebarFile })

  function render() {
    hookIndex = 0
    const tree = compiledModule.exports.Sidebar({
      vendorName: "Test seller",
      vendorEmail: "seller@example.test",
    })
    const bodies = nodes(tree, (node) => node.type?.name === "SidebarBody")
    assert.equal(bodies.length, 2)
    return bodies.map((body) => {
      const content = body.type(body.props)
      const buttons = nodes(content, (node) => node.type === Button)
      assert.equal(buttons.length, 1)
      return {
        button: buttons[0],
        alerts: nodes(content, (node) => node.type === "p" && node.props.role === "alert"),
      }
    })
  }

  return {
    render,
    signOutCalls,
    navigations,
    clientCreations: () => clientCreations,
  }
}

test("desktop and mobile share cookie-backed, local logout and wait before navigation", async () => {
  const pendingSignOut = deferred()
  const app = harness(() => pendingSignOut.promise)
  const initial = app.render()
  assert.equal(app.clientCreations(), 1)
  assert.equal(initial[0].button.props.onClick, initial[1].button.props.onClick)
  assert.equal(initial[0].button.props.disabled, false)

  const attempt = initial[0].button.props.onClick()
  assert.equal(app.signOutCalls.length, 1)
  assert.equal(app.signOutCalls[0].scope, "local")
  assert.equal(Object.keys(app.signOutCalls[0]).length, 1)
  assert.deepEqual(app.navigations, [])

  const during = app.render()
  assert.equal(app.clientCreations(), 1)
  assert.equal(during[0].button.props.disabled, true)
  assert.equal(during[1].button.props.disabled, true)
  assert.ok(during.every(({ button }) => button.props.children.includes("Signing out...")))
  await during[1].button.props.onClick()
  assert.equal(app.signOutCalls.length, 1)
  assert.deepEqual(app.navigations, [])

  pendingSignOut.resolve({ error: null })
  await attempt
  assert.deepEqual(app.navigations, ["/vendor/login"])
})

test("returned Auth errors stay on the page with controlled UI and allow retry", async () => {
  let attempts = 0
  const app = harness(() => ++attempts === 1
    ? { error: new Error("private provider detail") }
    : { error: null })

  await app.render()[0].button.props.onClick()
  assert.deepEqual(app.navigations, [])
  const afterFailure = app.render()
  assert.equal(afterFailure[0].button.props.disabled, false)
  assert.equal(afterFailure[1].button.props.disabled, false)
  for (const { alerts } of afterFailure) {
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0].props.children, "We couldn't sign you out. Please try again.")
    assert.equal(alerts[0].props.children.includes("private provider detail"), false)
  }

  await afterFailure[1].button.props.onClick()
  assert.equal(app.signOutCalls.length, 2)
  assert.deepEqual(app.navigations, ["/vendor/login"])
})

test("thrown Auth failures stay on the page and show no raw error", async () => {
  const app = harness(() => { throw new Error("private provider detail") })
  await app.render()[0].button.props.onClick()
  assert.deepEqual(app.navigations, [])
  assert.equal(app.render()[0].alerts[0].props.children, "We couldn't sign you out. Please try again.")
})

test("vendor sidebar never imports the plain localStorage client", () => {
  assert.equal(source.includes('from "@/lib/supabase"'), false)
  assert.match(source, /createSupabaseBrowserClient/)
})
