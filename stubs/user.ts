import { Column, columnBy, Entity, GeneratedValue, Id, Index } from '../src'


@Entity({name: "user"})
@Index<User>("created", columnBy(["createdAt"]))
export class User {

  @Id() @GeneratedValue({strategy: "uuid"})
  @Column({name: "user_id"})
  public id!: string

  @Column()
  public username!: string

  @Column()
  public email!: string

  @Column({name: "created_at"})
  public createdAt!: number
}
