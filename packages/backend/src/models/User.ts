import { Schema, model, Document } from 'mongoose';

/**
 * Interface interna para el documento de usuario en MongoDB
 * Extiende Document de Mongoose para acceder a métodos y propiedades de instancia
 */
interface UserDocument extends Document {
  email: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Schema del usuario
 * Define la estructura y validaciones del documento en MongoDB
 */
const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Modelo de usuario para operaciones CRUD en MongoDB
 * Se mapará a tipos de API en la capa de servicio
 */
export const UserModel = model<UserDocument>('User', userSchema);

export type { UserDocument };
