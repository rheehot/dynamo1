import { Transformer } from 'relater'
import { v4 as uuid } from 'uuid'

import { Connection } from '../connection/connection'
import { DynamoCursor } from '../interfaces/connection'
import { RepositoryOptions, RetrieveOptions, RetrieveResult } from '../interfaces/repository'


function encodeBase64(cursor: DynamoCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64')
}

function decodeBase64(buffer: string): DynamoCursor {
  return JSON.parse(Buffer.from(buffer, 'base64').toString('ascii'))
}

export class Repository<Entity> {

  public transformer: Transformer<Entity>

  public constructor(public connection: Connection, public options: RepositoryOptions<Entity>) {
    this.transformer = new Transformer(options)
  }

  public async retrieve({ limit = 20, after, index, desc = false }: RetrieveOptions = {}): Promise<RetrieveResult<Entity>> {
    let endCursor: DynamoCursor | undefined
    const nodes: {cursor: string, node: Entity}[] = []
    if (index) {
      const indexes = await this.connection.query(`${this.options.name}__${index}`, {
        limit,
        after: after ? decodeBase64(after) : undefined,
        desc,
      })
      const result = await this.connection.getManyItems(indexes.nodes.map(({ node }) => ({
        hashKey: node.sourcetype,
        rangeKey: node.sourceid,
      })))
      endCursor = indexes.endCursor
      indexes.nodes.forEach(({ node, cursor }) => {
        const foundNode = result.find((result) => {
          return result[this.connection.options.hashKey] === node.sourcetype
            && result[this.connection.options.rangeKey] === `${node.sourceid}`
        })
        if (foundNode) {
          foundNode[this.options.id.sourceKey] = foundNode[this.connection.options.rangeKey]
          nodes.push({
            node: this.transformer.toEntity(foundNode),
            cursor: encodeBase64(cursor),
          })
        }
      })
    } else {
      const result = await this.connection.query(this.options.name, {
        limit,
        after: after ? decodeBase64(after) : undefined,
        desc,
      })
      endCursor = result.endCursor
      result.nodes.forEach(({ node, cursor }) => {
        node[this.options.id.sourceKey] = node[this.connection.options.rangeKey]
        nodes.push({
          node: this.transformer.toEntity(node),
          cursor: encodeBase64(cursor),
        })
      })
    }

    if (endCursor) {
      return {
        nodes,
        endCursor: encodeBase64(endCursor),
      }
    }
    return {
      nodes,
    }
  }

  public async find(id: string): Promise<Entity | undefined> {
    const node = await this.connection.getItem(this.options.name, id)
    if (node) {
      node[this.options.id.sourceKey] = id
      return this.transformer.toEntity(node)
    }

  }

  public async create(attrs: Partial<Entity>): Promise<Entity> {
    const entity: any = { ...attrs }
    for (const generatedValue of this.options.generatedValues) {
      if (generatedValue.strategy === 'uuid') {
        entity[generatedValue.property] = uuid()
      }
    }
    Object.setPrototypeOf(entity, this.options.ctor.prototype)
    const id = entity[this.options.id.property]
    if (!id) {
      throw new Error('id not defined!')
    }
    await this.connection.putItems([
      {
        cursor: {
          hashKey: this.options.name,
          rangeKey: id,
        },
        node: this.transformer.toPlain(entity as Entity),
      },
      ...this.options.indexes.map((index) => {
        return {
          cursor: {
            hashKey: `${this.options.name}__${index.name}`,
            rangeKey: `${index.indexer(entity)}__${id}`,
          },
          node: {
            sourcetype: this.options.name,
            sourceid: id,
          },
        }
      }),
    ])
    return entity
  }

  public async persist(entity: Entity): Promise<void> {
    const id = (entity as any)[this.options.id.property]
    if (!id) {
      throw new Error('id not defined!')
    }

    // @todo remove legacy index
    // await this.connection.deleteManyItems([])

    await this.connection.putItems([
      {
        cursor: {
          hashKey: this.options.name,
          rangeKey: id,
        },
        node: this.transformer.toPlain(entity),
      },
      ...this.options.indexes.map((index) => {
        return {
          cursor: {
            hashKey: `${this.options.name}__${index.name}`,
            rangeKey: `${index.indexer(entity)}__${id}`,
          },
          node: {
            sourcetype: this.options.name,
            sourceid: id,
          },
        }
      }),
    ])
  }

  public async remove(entity: Entity): Promise<void> {
    const id = (entity as any)[this.options.id.property]
    if (!id) {
      throw new Error('id not defined!')
    }

    await this.connection.deleteManyItems([
      {
        hashKey: this.options.name,
        rangeKey: id,
      },
      ...this.options.indexes.map((index) => {
        return {
          hashKey: `${this.options.name}__${index.name}`,
          rangeKey: `${index.indexer(entity)}__${id}`,
        }
      }),
    ])
  }
}
