"use client"

import {
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NIGERIAN_STATES } from "@/lib/nigerian-states"

import {
  createCustomerAddress,
  deleteCustomerAddress,
  setDefaultCustomerAddress,
  type AddressActionResult,
  updateCustomerAddress,
} from "./actions"

type CustomerAddress = {
  id: string
  label: string
  address: string
  city: string
  state: string
  is_default: boolean
  created_at: string
  updated_at: string
}

type AddressManagerProps = {
  addresses: CustomerAddress[]
}

type FormValues = {
  label: string
  address: string
  city: string
  state: string
}

const EMPTY_FORM: FormValues = {
  label: "",
  address: "",
  city: "",
  state: "",
}

const inputClassName =
  "mt-2 h-11 border-zinc-300 bg-white px-3 text-zinc-900 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"

export function AddressManager({ addresses }: AddressManagerProps) {
  const router = useRouter()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [values, setValues] = useState<FormValues>(EMPTY_FORM)
  const [result, setResult] = useState<AddressActionResult | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const resultRef = useRef<HTMLDivElement>(null)

  const resetForm = () => {
    setValues(EMPTY_FORM)
    setEditingId(null)
    setIsFormOpen(false)
  }

  const focusResult = () => {
    requestAnimationFrame(() => resultRef.current?.focus())
  }

  const openAddForm = () => {
    setValues(EMPTY_FORM)
    setEditingId(null)
    setDeleteId(null)
    setResult(null)
    setIsFormOpen(true)
  }

  const openEditForm = (address: CustomerAddress) => {
    setValues({
      label: address.label,
      address: address.address,
      city: address.city,
      state: address.state,
    })
    setEditingId(address.id)
    setDeleteId(null)
    setResult(null)
    setIsFormOpen(true)
  }

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPending) return

    const formData = new FormData(event.currentTarget)
    const actionName = editingId ? "edit" : "add"
    setPendingAction(actionName)

    startTransition(async () => {
      const nextResult = editingId
        ? await updateCustomerAddress(formData)
        : await createCustomerAddress(formData)

      setResult(nextResult)
      setPendingAction(null)

      if (nextResult.status === "success") {
        resetForm()
        router.refresh()
      }

      focusResult()
    })
  }

  const runAddressAction = (
    actionName: "delete" | "default",
    addressId: string
  ) => {
    if (isPending) return

    const formData = new FormData()
    formData.set("address_id", addressId)
    setPendingAction(`${actionName}:${addressId}`)
    setResult(null)

    startTransition(async () => {
      const nextResult =
        actionName === "delete"
          ? await deleteCustomerAddress(formData)
          : await setDefaultCustomerAddress(formData)

      setResult(nextResult)
      setPendingAction(null)

      if (nextResult.status === "success") {
        setDeleteId(null)
        if (editingId === addressId) resetForm()
        router.refresh()
      }

      focusResult()
    })
  }

  const updateValue = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setResult(null)
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-600">
          {addresses.length === 0
            ? "No saved addresses yet."
            : `${addresses.length} saved ${addresses.length === 1 ? "address" : "addresses"}`}
        </p>
        {!isFormOpen && (
          <Button
            type="button"
            onClick={openAddForm}
            className="min-h-11 gap-2 bg-amber-500 px-5 font-semibold text-zinc-900 hover:bg-amber-400"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add address
          </Button>
        )}
      </div>

      {result && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role={result.status === "error" ? "alert" : "status"}
          aria-live={result.status === "error" ? "assertive" : "polite"}
          className={`rounded-xl border px-4 py-3 text-sm leading-6 outline-none ${
            result.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {result.message}
        </div>
      )}

      {isFormOpen && (
        <AddressForm
          editingId={editingId}
          values={values}
          result={result}
          isPending={isPending}
          pendingAction={pendingAction}
          onSubmit={handleFormSubmit}
          onCancel={resetForm}
          onChange={updateValue}
        />
      )}

      {addresses.length === 0 && !isFormOpen ? (
        <section className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center shadow-sm">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
            <MapPin className="size-8" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-xl font-semibold text-zinc-900">
            No saved addresses
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
            Add a delivery address now so it is ready for a future checkout.
          </p>
          <Button
            type="button"
            onClick={openAddForm}
            className="mt-6 min-h-11 gap-2 bg-amber-500 px-5 font-semibold text-zinc-900 hover:bg-amber-400"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add address
          </Button>
        </section>
      ) : addresses.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {addresses.map((address) => (
            <article
              key={address.id}
              className={`rounded-2xl border bg-white p-5 shadow-sm ${
                address.is_default ? "border-amber-300" : "border-zinc-200"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold text-zinc-900">
                    {address.label}
                  </h2>
                  {address.is_default && (
                    <Badge className="mt-2 bg-amber-100 text-amber-800">
                      <Star className="size-3" aria-hidden="true" />
                      Default
                    </Badge>
                  )}
                </div>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
                  <MapPin className="size-5" aria-hidden="true" />
                </span>
              </div>

              <address className="mt-4 break-words text-sm not-italic leading-6 text-zinc-600">
                <span className="block">{address.address}</span>
                <span className="block">
                  {address.city}, {address.state}
                </span>
              </address>

              {deleteId === address.id ? (
                <div
                  role="group"
                  aria-label={`Confirm deletion of ${address.label}`}
                  className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4"
                >
                  <p className="text-sm font-medium text-red-800">
                    Delete this saved address? This cannot be undone.
                  </p>
                  {address.is_default && (
                    <p className="mt-1 text-xs leading-5 text-red-700">
                      No replacement default will be selected automatically.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isPending}
                      onClick={() => runAddressAction("delete", address.id)}
                      className="min-h-10 gap-2 px-4"
                    >
                      {pendingAction === `delete:${address.id}` && (
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      {pendingAction === `delete:${address.id}`
                        ? "Deleting..."
                        : "Confirm delete"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => setDeleteId(null)}
                      className="min-h-10 px-4"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => openEditForm(address)}
                    className="min-h-10 gap-2 px-4"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => {
                      setDeleteId(address.id)
                      setResult(null)
                    }}
                    className="min-h-10 gap-2 border-red-200 px-4 text-red-700 hover:bg-red-50 hover:text-red-800"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </Button>
                  {!address.is_default && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        runAddressAction("default", address.id)
                      }
                      className="min-h-10 gap-2 border-amber-300 px-4 text-amber-800 hover:bg-amber-50 hover:text-amber-900"
                    >
                      {pendingAction === `default:${address.id}` ? (
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Star className="size-4" aria-hidden="true" />
                      )}
                      {pendingAction === `default:${address.id}`
                        ? "Updating..."
                        : "Set as default"}
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AddressForm({
  editingId,
  values,
  result,
  isPending,
  pendingAction,
  onSubmit,
  onCancel,
  onChange,
}: {
  editingId: string | null
  values: FormValues
  result: AddressActionResult | null
  isPending: boolean
  pendingAction: string | null
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onChange: (field: keyof FormValues, value: string) => void
}) {
  const idPrefix = editingId ? `edit-${editingId}` : "add"
  const isSaving = pendingAction === (editingId ? "edit" : "add")

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">
            {editingId ? "Edit address" : "Add address"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {editingId
              ? "Update the delivery address details below."
              : "Your first saved address becomes the default."}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isPending}
          onClick={onCancel}
          aria-label="Close address form"
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </div>

      {editingId && (
        <input type="hidden" name="address_id" value={editingId} />
      )}

      <fieldset disabled={isPending} className="mt-6 grid gap-5 sm:grid-cols-2">
        <legend className="sr-only">Saved address details</legend>

        <div>
          <Label htmlFor={`${idPrefix}-label`}>Label (required)</Label>
          <Input
            id={`${idPrefix}-label`}
            name="label"
            maxLength={50}
            required
            value={values.label}
            onChange={(event) => onChange("label", event.target.value)}
            placeholder="Home or Office"
            aria-invalid={Boolean(result?.fieldErrors?.label)}
            aria-describedby={
              result?.fieldErrors?.label
                ? `${idPrefix}-label-error`
                : `${idPrefix}-label-help`
            }
            className={inputClassName}
          />
          {result?.fieldErrors?.label ? (
            <p
              id={`${idPrefix}-label-error`}
              className="mt-1.5 text-sm text-red-600"
            >
              {result.fieldErrors.label}
            </p>
          ) : (
            <p
              id={`${idPrefix}-label-help`}
              className="mt-1.5 text-xs text-zinc-500"
            >
              1 to 50 characters.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-city`}>City (required)</Label>
          <Input
            id={`${idPrefix}-city`}
            name="city"
            maxLength={100}
            minLength={2}
            required
            value={values.city}
            onChange={(event) => onChange("city", event.target.value)}
            autoComplete="address-level2"
            aria-invalid={Boolean(result?.fieldErrors?.city)}
            aria-describedby={
              result?.fieldErrors?.city
                ? `${idPrefix}-city-error`
                : `${idPrefix}-city-help`
            }
            className={inputClassName}
          />
          {result?.fieldErrors?.city ? (
            <p
              id={`${idPrefix}-city-error`}
              className="mt-1.5 text-sm text-red-600"
            >
              {result.fieldErrors.city}
            </p>
          ) : (
            <p
              id={`${idPrefix}-city-help`}
              className="mt-1.5 text-xs text-zinc-500"
            >
              2 to 100 characters.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-address`}>
            Address line (required)
          </Label>
          <Input
            id={`${idPrefix}-address`}
            name="address"
            maxLength={300}
            minLength={5}
            required
            value={values.address}
            onChange={(event) => onChange("address", event.target.value)}
            autoComplete="street-address"
            aria-invalid={Boolean(result?.fieldErrors?.address)}
            aria-describedby={
              result?.fieldErrors?.address
                ? `${idPrefix}-address-error`
                : `${idPrefix}-address-help`
            }
            className={inputClassName}
          />
          {result?.fieldErrors?.address ? (
            <p
              id={`${idPrefix}-address-error`}
              className="mt-1.5 text-sm text-red-600"
            >
              {result.fieldErrors.address}
            </p>
          ) : (
            <p
              id={`${idPrefix}-address-help`}
              className="mt-1.5 text-xs text-zinc-500"
            >
              5 to 300 characters.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-state`}>State (required)</Label>
          <select
            id={`${idPrefix}-state`}
            name="state"
            required
            value={values.state}
            onChange={(event) => onChange("state", event.target.value)}
            autoComplete="address-level1"
            aria-invalid={Boolean(result?.fieldErrors?.state)}
            aria-describedby={
              result?.fieldErrors?.state
                ? `${idPrefix}-state-error`
                : `${idPrefix}-state-help`
            }
            className="mt-2 h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Select state</option>
            {NIGERIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          {result?.fieldErrors?.state ? (
            <p
              id={`${idPrefix}-state-error`}
              className="mt-1.5 text-sm text-red-600"
            >
              {result.fieldErrors.state}
            </p>
          ) : (
            <p
              id={`${idPrefix}-state-help`}
              className="mt-1.5 text-xs text-zinc-500"
            >
              Choose from the approved Nigerian state list.
            </p>
          )}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onCancel}
          className="min-h-11 px-5"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className="min-h-11 gap-2 bg-amber-500 px-5 font-semibold text-zinc-900 hover:bg-amber-400"
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          {isSaving
            ? editingId
              ? "Saving changes..."
              : "Adding address..."
            : editingId
              ? "Save changes"
              : "Add address"}
        </Button>
      </div>
    </form>
  )
}
