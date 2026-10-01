import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { SearchField } from '@/components/ui/search-field';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Filter, SlidersHorizontal, ArrowUpDown } from 'lucide-react';

const meta: Meta = {
  title: 'Patterns/Search & Filter Bar',
  parameters: {
    layout: 'centered',
  },
};

export default meta;

export const CatalogSearchRecipe: StoryObj = {
  name: 'Catalog Search & Filter Bar',
  render: () => {
    const [search, setSearch] = React.useState('');
    const [filterCount, setFilterCount] = React.useState(2);

    return (
      <div className="w-[580px] rounded-card border border-border bg-shell p-3 space-y-3 shadow-raised">
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="flex-1">
            <SearchField
              placeholder="Filter components, services, or brokers..."
              value={search}
              onChange={setSearch}
              onClear={() => setSearch('')}
              className="bg-background"
            />
          </div>

          {/* Filter Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs font-medium">
                <SlidersHorizontal className="size-3.5" />
                <span>Filters</span>
                {filterCount > 0 && (
                  <Badge variant="accent" className="ml-0.5 px-1 py-0 text-[10px]">
                    {filterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3 space-y-3" align="end">
              <span className="font-semibold text-xs text-ink block border-b border-border pb-1.5">
                Component Types
              </span>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox defaultChecked />
                  <span>Gateways & Routers</span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox defaultChecked />
                  <span>Compute Services</span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox />
                  <span>Message Brokers</span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox />
                  <span>Databases & Caches</span>
                </label>
              </div>
            </PopoverContent>
          </Popover>

          {/* Sort Selector */}
          <div className="w-32">
            <NativeSelect defaultValue="name" className="h-8 text-xs bg-background">
              <option value="name">Name A-Z</option>
              <option value="layer">By Layer</option>
              <option value="recent">Recently Added</option>
            </NativeSelect>
          </div>
        </div>

        {/* Active Filter Chips */}
        <div className="flex items-center gap-1.5 pt-1 text-xs">
          <span className="text-[11px] text-secondary-text">Active:</span>
          <Badge variant="neutral" className="gap-1 text-[11px]">
            Gateways <span className="cursor-pointer font-bold ml-0.5">×</span>
          </Badge>
          <Badge variant="neutral" className="gap-1 text-[11px]">
            Compute Services <span className="cursor-pointer font-bold ml-0.5">×</span>
          </Badge>
        </div>
      </div>
    );
  },
};
