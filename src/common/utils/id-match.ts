import { Types } from 'mongoose';

// Matches a reference field regardless of whether it was stored as a string
// or an ObjectId.
//
// Every @Prop({ type: Types.ObjectId }) in this codebase actually compiles to
// a **Mixed** schema path: `mongoose.Types.ObjectId` is the value
// constructor, and Mongoose (v9) only recognises
// `mongoose.Schema.Types.ObjectId` as the ObjectId *schema type*. A Mixed
// path does no casting, so each reference is persisted in whatever shape the
// calling code happened to hold:
//
//   create({ businessId })                        -> string (from the JWT)
//   service.assignedTechnicianId = new ObjectId() -> ObjectId
//
// The live database shows exactly that split on
// services.assignedTechnicianId (1 string, 2 ObjectIds), which meant a
// technician's own jobs were invisible to them whenever the row happened to
// be stored in the other representation.
//
// Until the schema types are corrected and the data migrated, every query on
// a reference field has to accept both. Returns a value usable directly as a
// field filter.
export function idFilter(id: string): { $in: (string | Types.ObjectId)[] } {
  const values: (string | Types.ObjectId)[] = [id];
  if (Types.ObjectId.isValid(id)) values.push(new Types.ObjectId(id));
  return { $in: values };
}

// Same, for a list of ids.
export function idsFilter(ids: string[]): { $in: (string | Types.ObjectId)[] } {
  const values: (string | Types.ObjectId)[] = [];
  for (const id of ids) {
    values.push(id);
    if (Types.ObjectId.isValid(id)) values.push(new Types.ObjectId(id));
  }
  return { $in: values };
}
