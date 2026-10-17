type ContentSectionProps = {
  title: string
  desc: string
  children: React.JSX.Element
}

export function ContentSection({ title, desc, children }: ContentSectionProps) {
  return (
    <section className='w-full max-w-2xl space-y-6'>
      <div className='space-y-1'>
        <h2 className='text-lg font-semibold'>{title}</h2>
        <p className='text-sm leading-relaxed text-muted-foreground'>{desc}</p>
      </div>
      {children}
    </section>
  )
}
