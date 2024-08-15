import { GetOptions, Level, OpenOptions, PutOptions } from 'level';

export interface LevelDocument {
    _id?: any;
    _documentType?: string;
}

export interface LevelDocumentConstructor<T extends LevelDocument> {
    new(): T;
}

function createLevelDocument(documentConstructor: any, json: any) {
    const doc = new documentConstructor();
    Object.assign(doc, JSON.parse(json));
    return doc;
}

class Foo {

}

export class WrappedLevel extends Level<string, string | number> {
    curId: number;

    async open(): Promise<void>;
    async open(options?: OpenOptions): Promise<void> {
        await super.open(options);
        try {
            this.curId = parseInt(await this.get('_id') as string);
        }
        catch (e) {
        }
        if (!this.curId)
            this.curId = 0;
    }


    async tryGet<T>(documentConstructor: new () => T, _id: any, options?: GetOptions<string, string | number>): Promise<T> {
        try {
            const _documentType = documentConstructor.name;
            const key = `${_documentType}/${_id}`;
            const json = await this.get(key, options)
            return createLevelDocument(documentConstructor, json);
        }
        catch (e) {
        }
    }

    async* getAll(documentConstructor: any): AsyncIterable<any> {
        const _documentType = documentConstructor.name;
        const prefix = `${_documentType}/`;
        for await (const [key, value] of this.iterator()) {
            if (key.startsWith(prefix)) {
                const doc = createLevelDocument(documentConstructor, value);
                if (doc._documentType === _documentType) {
                    yield doc;
                }
            }
        }
    }

    async getCount(documentConstructor: any) {
        let count = 0;
        for await (const doc of this.getAll(documentConstructor)) {
            count++;
        }
        return count;
    }

    nextId() {
        if (typeof this.curId !== 'number')
            throw new Error('curId is not a number');
        return ++this.curId;
    }

    async saveId() {
        return this.put("_id", this.curId);
    }

    async upsert(value: LevelDocument, options?: PutOptions<string, string | number>): Promise<any> {
        const _documentType = value.constructor.name;
        if (!value._id)
            value._id = this.nextId();

        await this.saveId();

        value._documentType = _documentType;
        const key = `${_documentType}/${value._id}`;
        await this.put(key, JSON.stringify(value), options);
        return value;
    };

    async remove(value: LevelDocument) {
        const _documentType = value.constructor.name;
        let { _id } = value;
        const key = `${_documentType}/${_id}`;
        await this.del(key);
    }

    async removeId(documentConstructor: LevelDocumentConstructor<any>, _id: any) {
        const _documentType = documentConstructor.name;
        const key = `${_documentType}/${_id}`;
        await this.del(key);
    }

    async removeAll(documentConstructor: LevelDocumentConstructor<any>) {
        const _documentType = documentConstructor.name;
        const prefix = `${_documentType}/`;
        for await (const [key, value] of this.iterator()) {
            if (key.startsWith(prefix)) {
                const doc = createLevelDocument(documentConstructor, value);
                if (doc._documentType === _documentType) {
                    await this.del(key);
                }
            }
        }
    }
}

export default WrappedLevel;
